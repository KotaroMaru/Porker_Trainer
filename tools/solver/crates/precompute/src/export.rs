//! FORMAT.md準拠の.binバイナリライタ。
//! レイアウトの正典は tools/solver/FORMAT.md セクション4。

/// 1決断ノード分のエクスポートデータ。freq/evはaction-major
/// (`[action*handCount+hand]`)で、handCountはplayerが0ならOOP、1ならIPの
/// コンボ数と一致する(SolutionExport側で検証する)。
pub struct NodeExport {
    pub node_id: String,
    pub player: u8, // 0=OOP, 1=IP
    pub action_labels: Vec<String>,
    pub freq: Vec<f32>,  // 0.0..=1.0, action-major
    pub ev_bb: Vec<f32>, // bb単位, action-major
}

pub struct SolutionExport {
    pub scenario_id: String,
    pub flop_card_ids: [u8; 3],
    pub starting_pot_chips: u32,
    pub effective_stack_chips: u32,
    pub oop_combos: Vec<(u8, u8)>,
    pub ip_combos: Vec<(u8, u8)>,
    pub nodes: Vec<NodeExport>,
    /// solve()が返した最終exploitability(pot比)。.binには含めない
    /// (FORMAT.mdのバイナリ仕様は変更しない)。manifest.json出力・ログ専用のメタデータ。
    pub exploitability_pot_frac: f32,
}

/// FORMAT.md Section 7の索引キーと、既存単体.bin形式の解。
pub struct TurnBundleSolution {
    pub turn_card_id: u8,
    pub solution: SolutionExport,
}

fn push_u8_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    assert!(
        bytes.len() <= u8::MAX as usize,
        "string too long for u8-length prefix: {s}"
    );
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(bytes);
}

fn freq_to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn ev_to_i16(bb: f32) -> i16 {
    (bb as f64 * 100.0)
        .round()
        .clamp(i16::MIN as f64, i16::MAX as f64) as i16
}

pub fn write_binary(sol: &SolutionExport) -> Vec<u8> {
    for node in &sol.nodes {
        let hand_count = if node.player == 0 {
            sol.oop_combos.len()
        } else {
            sol.ip_combos.len()
        };
        let expected_len = node.action_labels.len() * hand_count;
        assert_eq!(
            node.freq.len(),
            expected_len,
            "freq length mismatch for node {}",
            node.node_id
        );
        assert_eq!(
            node.ev_bb.len(),
            expected_len,
            "ev length mismatch for node {}",
            node.node_id
        );
        // ラベルの重複はnodeId衝突(=別ラインが同じIDになる)として静かに壊れるため
        // ここで検出する。bet_labelの近接判定が万一同一ラベルへ写像した場合の保険。
        for (i, a) in node.action_labels.iter().enumerate() {
            for b in &node.action_labels[i + 1..] {
                assert_ne!(
                    a, b,
                    "duplicate action label '{a}' in node '{}'",
                    node.node_id
                );
            }
        }
    }

    let mut header = Vec::new();
    header.extend_from_slice(b"GTO1");
    header.push(1u8); // version
    push_u8_str(&mut header, &sol.scenario_id);
    header.extend_from_slice(&sol.flop_card_ids);
    header.extend_from_slice(&sol.starting_pot_chips.to_le_bytes());
    header.extend_from_slice(&sol.effective_stack_chips.to_le_bytes());

    let mut combo_table = Vec::new();
    for combos in [&sol.oop_combos, &sol.ip_combos] {
        assert!(
            combos.len() <= u16::MAX as usize,
            "too many combos for u16 count"
        );
        combo_table.extend_from_slice(&(combos.len() as u16).to_le_bytes());
        for &(a, b) in combos {
            combo_table.push(a);
            combo_table.push(b);
        }
    }

    // データ本体を先に構築し、各ノードのオフセットを確定させてからノード表を書く。
    let mut data_body = Vec::new();
    let mut data_offsets = Vec::with_capacity(sol.nodes.len());
    for node in &sol.nodes {
        data_offsets.push(data_body.len() as u32);
        for &v in &node.freq {
            data_body.push(freq_to_u8(v));
        }
        for &v in &node.ev_bb {
            data_body.extend_from_slice(&ev_to_i16(v).to_le_bytes());
        }
    }

    let mut node_table = Vec::new();
    assert!(
        sol.nodes.len() <= u16::MAX as usize,
        "too many nodes for u16 count"
    );
    node_table.extend_from_slice(&(sol.nodes.len() as u16).to_le_bytes());
    for (node, &offset) in sol.nodes.iter().zip(&data_offsets) {
        push_u8_str(&mut node_table, &node.node_id);
        node_table.push(node.player);
        assert!(
            node.action_labels.len() <= u8::MAX as usize,
            "too many actions for u8 count"
        );
        node_table.push(node.action_labels.len() as u8);
        for label in &node.action_labels {
            push_u8_str(&mut node_table, label);
        }
        node_table.extend_from_slice(&offset.to_le_bytes());
    }

    let mut out =
        Vec::with_capacity(header.len() + combo_table.len() + node_table.len() + data_body.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&combo_table);
    out.extend_from_slice(&node_table);
    out.extend_from_slice(&data_body);
    out
}

/// FORMAT.md Section 7準拠のターンバンドルを書き出す。
/// 個々の解は既存write_binary()の出力を変更せず、そのまま本体へ連結する。
pub fn write_turn_bundle(
    scenario_id: &str,
    flop_card_ids: [u8; 3],
    path_id: &str,
    entries: &[TurnBundleSolution],
) -> Result<Vec<u8>, String> {
    if entries.len() > u8::MAX as usize {
        return Err("too many turn bundle entries for u8 count".to_string());
    }
    if scenario_id.len() > u8::MAX as usize || path_id.len() > u8::MAX as usize {
        return Err("bundle scenarioId/pathId exceeds u8 string length".to_string());
    }
    if !path_id.is_ascii() {
        return Err("bundle pathId must be ASCII".to_string());
    }

    let mut sorted: Vec<&TurnBundleSolution> = entries.iter().collect();
    sorted.sort_by_key(|entry| entry.turn_card_id);
    for (index, entry) in sorted.iter().enumerate() {
        if entry.turn_card_id >= 52 {
            return Err(format!("invalid turn card id {}", entry.turn_card_id));
        }
        if flop_card_ids.contains(&entry.turn_card_id) {
            return Err(format!(
                "turn card {} overlaps the flop",
                entry.turn_card_id
            ));
        }
        if index > 0 && sorted[index - 1].turn_card_id == entry.turn_card_id {
            return Err(format!("duplicate turn card id {}", entry.turn_card_id));
        }
        if entry.solution.scenario_id != scenario_id
            || entry.solution.flop_card_ids != flop_card_ids
        {
            return Err(format!(
                "turn card {} solution header does not match bundle header",
                entry.turn_card_id
            ));
        }
    }

    let blobs: Vec<Vec<u8>> = sorted
        .iter()
        .map(|entry| write_binary(&entry.solution))
        .collect();
    let mut header = Vec::new();
    header.extend_from_slice(b"GTOB");
    header.push(1);
    push_u8_str(&mut header, scenario_id);
    header.extend_from_slice(&flop_card_ids);
    push_u8_str(&mut header, path_id);
    header.push(sorted.len() as u8);

    let mut index = Vec::with_capacity(sorted.len() * 9);
    let mut offset = 0u32;
    for (entry, blob) in sorted.iter().zip(&blobs) {
        let length = u32::try_from(blob.len())
            .map_err(|_| "turn solution blob exceeds u32 length".to_string())?;
        index.push(entry.turn_card_id);
        index.extend_from_slice(&offset.to_le_bytes());
        index.extend_from_slice(&length.to_le_bytes());
        offset = offset
            .checked_add(length)
            .ok_or_else(|| "turn bundle body exceeds u32 offsets".to_string())?;
    }

    let body_len =
        usize::try_from(offset).map_err(|_| "turn bundle body does not fit usize".to_string())?;
    let mut out = Vec::with_capacity(header.len() + index.len() + body_len);
    out.extend_from_slice(&header);
    out.extend_from_slice(&index);
    for blob in blobs {
        out.extend_from_slice(&blob);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Reader<'a> {
        buf: &'a [u8],
        pos: usize,
    }
    impl<'a> Reader<'a> {
        fn new(buf: &'a [u8]) -> Self {
            Self { buf, pos: 0 }
        }
        fn u8(&mut self) -> u8 {
            let v = self.buf[self.pos];
            self.pos += 1;
            v
        }
        fn bytes(&mut self, n: usize) -> &'a [u8] {
            let v = &self.buf[self.pos..self.pos + n];
            self.pos += n;
            v
        }
        fn u16(&mut self) -> u16 {
            u16::from_le_bytes(self.bytes(2).try_into().unwrap())
        }
        fn u32(&mut self) -> u32 {
            u32::from_le_bytes(self.bytes(4).try_into().unwrap())
        }
        fn i16(&mut self) -> i16 {
            i16::from_le_bytes(self.bytes(2).try_into().unwrap())
        }
        fn str_u8(&mut self) -> String {
            let len = self.u8() as usize;
            String::from_utf8(self.bytes(len).to_vec()).unwrap()
        }
    }

    #[test]
    fn round_trip() {
        let sol = SolutionExport {
            scenario_id: "srp_btn_vs_bb".to_string(),
            flop_card_ids: [10, 20, 30],
            starting_pot_chips: 55,
            effective_stack_chips: 975,
            oop_combos: vec![(0, 1), (2, 3)],
            ip_combos: vec![(4, 5), (6, 7), (8, 9)],
            exploitability_pot_frac: 0.001,
            nodes: vec![NodeExport {
                node_id: "".to_string(),
                player: 0,
                action_labels: vec!["check".to_string(), "bet33".to_string()],
                freq: vec![0.5, 1.0, 0.5, 0.0], // action-major: [check: h0,h1][bet33: h0,h1]
                ev_bb: vec![1.23, -4.5, -1.23, 4.5],
            }],
        };

        let bytes = write_binary(&sol);
        let mut r = Reader::new(&bytes);

        assert_eq!(r.bytes(4), b"GTO1");
        assert_eq!(r.u8(), 1);
        assert_eq!(r.str_u8(), "srp_btn_vs_bb");
        assert_eq!(r.bytes(3), &[10, 20, 30]);
        assert_eq!(r.u32(), 55);
        assert_eq!(r.u32(), 975);

        assert_eq!(r.u16(), 2);
        assert_eq!(r.bytes(2), &[0, 1]);
        assert_eq!(r.bytes(2), &[2, 3]);
        assert_eq!(r.u16(), 3);
        assert_eq!(r.bytes(2), &[4, 5]);
        assert_eq!(r.bytes(2), &[6, 7]);
        assert_eq!(r.bytes(2), &[8, 9]);

        assert_eq!(r.u16(), 1); // node count
        assert_eq!(r.str_u8(), "");
        assert_eq!(r.u8(), 0); // player
        assert_eq!(r.u8(), 2); // action count
        assert_eq!(r.str_u8(), "check");
        assert_eq!(r.str_u8(), "bet33");
        assert_eq!(r.u32(), 0); // dataOffset

        // freq: 0.5→round(127.5)=128, 1.0→255, 0.5→128, 0.0→0
        assert_eq!(r.u8(), 128);
        assert_eq!(r.u8(), 255);
        assert_eq!(r.u8(), 128);
        assert_eq!(r.u8(), 0);
        // ev: 0.01bb単位
        assert_eq!(r.i16(), 123);
        assert_eq!(r.i16(), -450);
        assert_eq!(r.i16(), -123);
        assert_eq!(r.i16(), 450);
    }

    fn fixture_solution(freq: f32, ev_bb: f32) -> SolutionExport {
        SolutionExport {
            scenario_id: "test".to_string(),
            flop_card_ids: [0, 5, 10],
            starting_pot_chips: 55,
            effective_stack_chips: 975,
            oop_combos: vec![(1, 2)],
            ip_combos: vec![(3, 4)],
            exploitability_pot_frac: 0.001,
            nodes: vec![NodeExport {
                node_id: "".to_string(),
                player: 0,
                action_labels: vec!["check".to_string()],
                freq: vec![freq],
                ev_bb: vec![ev_bb],
            }],
        }
    }

    #[test]
    fn turn_bundle_index_boundaries_and_quantized_values_round_trip() {
        let first = fixture_solution(0.501, 1.234);
        let second = fixture_solution(0.249, -4.567);
        let expected_blobs = [write_binary(&first), write_binary(&second)];
        let bundle = write_turn_bundle(
            "test",
            [0, 5, 10],
            "check-check",
            &[
                TurnBundleSolution {
                    turn_card_id: 12,
                    solution: second,
                },
                TurnBundleSolution {
                    turn_card_id: 7,
                    solution: first,
                },
            ],
        )
        .unwrap();

        let mut r = Reader::new(&bundle);
        assert_eq!(r.bytes(4), b"GTOB");
        assert_eq!(r.u8(), 1);
        assert_eq!(r.str_u8(), "test");
        assert_eq!(r.bytes(3), &[0, 5, 10]);
        assert_eq!(r.str_u8(), "check-check");
        assert_eq!(r.u8(), 2);
        let first_card = r.u8();
        let first_offset = r.u32() as usize;
        let first_len = r.u32() as usize;
        let second_card = r.u8();
        let second_offset = r.u32() as usize;
        let second_len = r.u32() as usize;
        let body_start = r.pos;

        assert_eq!([first_card, second_card], [7, 12]);
        assert_eq!(first_offset, 0);
        assert_eq!(second_offset, first_len);
        assert_eq!(first_len, expected_blobs[0].len());
        assert_eq!(second_len, expected_blobs[1].len());
        assert_eq!(
            &bundle[body_start + first_offset..body_start + first_offset + first_len],
            expected_blobs[0]
        );
        assert_eq!(
            &bundle[body_start + second_offset..body_start + second_offset + second_len],
            expected_blobs[1]
        );

        // write_binary量子化後の値を読み戻す。freq許容差=1/255、EV許容差=0.01bb。
        for (blob, expected_freq, expected_ev) in [
            (&expected_blobs[0], 0.501f32, 1.234f32),
            (&expected_blobs[1], 0.249f32, -4.567f32),
        ] {
            let mut blob_reader = Reader::new(blob);
            blob_reader.bytes(4);
            blob_reader.u8();
            blob_reader.str_u8();
            blob_reader.bytes(3);
            blob_reader.u32();
            blob_reader.u32();
            blob_reader.u16();
            blob_reader.bytes(2);
            blob_reader.u16();
            blob_reader.bytes(2);
            blob_reader.u16();
            blob_reader.str_u8();
            blob_reader.u8();
            blob_reader.u8();
            blob_reader.str_u8();
            blob_reader.u32();
            let decoded_freq = blob_reader.u8() as f32 / 255.0;
            let decoded_ev = blob_reader.i16() as f32 / 100.0;
            assert!((decoded_freq - expected_freq).abs() <= 1.0 / 255.0);
            assert!((decoded_ev - expected_ev).abs() <= 0.01);
        }
    }
}
