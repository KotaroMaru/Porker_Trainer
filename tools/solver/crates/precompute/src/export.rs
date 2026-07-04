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
}

fn push_u8_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    assert!(bytes.len() <= u8::MAX as usize, "string too long for u8-length prefix: {s}");
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(bytes);
}

fn freq_to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn ev_to_i16(bb: f32) -> i16 {
    (bb as f64 * 100.0).round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
}

pub fn write_binary(sol: &SolutionExport) -> Vec<u8> {
    for node in &sol.nodes {
        let hand_count = if node.player == 0 { sol.oop_combos.len() } else { sol.ip_combos.len() };
        let expected_len = node.action_labels.len() * hand_count;
        assert_eq!(node.freq.len(), expected_len, "freq length mismatch for node {}", node.node_id);
        assert_eq!(node.ev_bb.len(), expected_len, "ev length mismatch for node {}", node.node_id);
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
        assert!(combos.len() <= u16::MAX as usize, "too many combos for u16 count");
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
    assert!(sol.nodes.len() <= u16::MAX as usize, "too many nodes for u16 count");
    node_table.extend_from_slice(&(sol.nodes.len() as u16).to_le_bytes());
    for (node, &offset) in sol.nodes.iter().zip(&data_offsets) {
        push_u8_str(&mut node_table, &node.node_id);
        node_table.push(node.player);
        assert!(node.action_labels.len() <= u8::MAX as usize, "too many actions for u8 count");
        node_table.push(node.action_labels.len() as u8);
        for label in &node.action_labels {
            push_u8_str(&mut node_table, label);
        }
        node_table.extend_from_slice(&offset.to_le_bytes());
    }

    let mut out = Vec::with_capacity(header.len() + combo_table.len() + node_table.len() + data_body.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&combo_table);
    out.extend_from_slice(&node_table);
    out.extend_from_slice(&data_body);
    out
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
}
