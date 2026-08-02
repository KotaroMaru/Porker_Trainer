//! FORMAT.md v1 のフロップ解を読み、指定アクション経路の到達レンジを復元する。

use crate::scenario::Scenario;
use postflop_solver::{Card, Range};
use std::collections::BTreeMap;
use std::path::Path;

// src/gto/trainer/rangeTracker.ts と同じ値。量子化で0になった低頻度行動でも、
// プレイ時と同じレンジ更新結果になるようにする。
const RANGE_TRACKER_EPSILON: f32 = 0.005;

#[derive(Debug)]
struct DecodedNode {
    player: usize,
    action_labels: Vec<String>,
    freqs: Vec<f32>,
}

#[derive(Debug)]
pub struct ReachedRanges {
    pub ranges: [Range; 2],
    pub combo_counts: [usize; 2],
}

#[derive(Debug)]
pub struct FlopSolution {
    scenario_id: String,
    flop: [Card; 3],
    starting_pot_chips: u32,
    effective_stack_chips: u32,
    combos: [Vec<(Card, Card)>; 2],
    nodes: BTreeMap<String, DecodedNode>,
}

#[derive(Debug)]
struct NodeMeta {
    node_id: String,
    player: usize,
    action_labels: Vec<String>,
    data_offset: usize,
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(len).ok_or("binary offset overflow")?;
        let out = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| format!("unexpected EOF at byte {} (need {len} bytes)", self.pos))?;
        self.pos = end;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }

    fn string_u8(&mut self) -> Result<String, String> {
        let len = self.u8()? as usize;
        String::from_utf8(self.bytes(len)?.to_vec())
            .map_err(|e| format!("invalid UTF-8 string: {e}"))
    }
}

impl FlopSolution {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("failed to read flop solution {path:?}: {e}"))?;
        Self::from_bytes(&bytes)
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = Reader::new(bytes);
        if reader.bytes(4)? != b"GTO1" {
            return Err("invalid flop solution magic (expected GTO1)".to_string());
        }
        let version = reader.u8()?;
        if version != 1 {
            return Err(format!("unsupported flop solution version: {version}"));
        }

        let scenario_id = reader.string_u8()?;
        let flop: [Card; 3] = reader.bytes(3)?.try_into().unwrap();
        let starting_pot_chips = reader.u32()?;
        let effective_stack_chips = reader.u32()?;

        let mut combos: [Vec<(Card, Card)>; 2] = std::array::from_fn(|_| Vec::new());
        for player_combos in &mut combos {
            let count = reader.u16()? as usize;
            player_combos.reserve(count);
            for _ in 0..count {
                let first = reader.u8()?;
                let second = reader.u8()?;
                if first >= second || second >= 52 {
                    return Err(format!("invalid private-card combo ({first}, {second})"));
                }
                player_combos.push((first, second));
            }
        }

        let node_count = reader.u16()? as usize;
        let mut metas = Vec::with_capacity(node_count);
        for _ in 0..node_count {
            let node_id = reader.string_u8()?;
            let player = reader.u8()? as usize;
            if player > 1 {
                return Err(format!("invalid player {player} at node '{node_id}'"));
            }
            let action_count = reader.u8()? as usize;
            let mut action_labels = Vec::with_capacity(action_count);
            for _ in 0..action_count {
                action_labels.push(reader.string_u8()?);
            }
            let data_offset = reader.u32()? as usize;
            metas.push(NodeMeta {
                node_id,
                player,
                action_labels,
                data_offset,
            });
        }

        let data_start = reader.pos;
        let mut nodes = BTreeMap::new();
        for meta in metas {
            let hand_count = combos[meta.player].len();
            let value_count = meta
                .action_labels
                .len()
                .checked_mul(hand_count)
                .ok_or("node value count overflow")?;
            // freq=u8×Nの後にEV=i16×Nが続く。EVはレンジ復元に使わないが、
            // レコード全体がファイル内に収まることは検証する。
            let record_len = value_count
                .checked_mul(3)
                .ok_or("node record length overflow")?;
            let record_start = data_start
                .checked_add(meta.data_offset)
                .ok_or("node data offset overflow")?;
            let record_end = record_start
                .checked_add(record_len)
                .ok_or("node data end overflow")?;
            if record_end > bytes.len() {
                return Err(format!("node '{}' data exceeds file length", meta.node_id));
            }
            let freqs = bytes[record_start..record_start + value_count]
                .iter()
                .map(|&value| value as f32 / 255.0)
                .collect();
            let node_id = meta.node_id.clone();
            if nodes
                .insert(
                    meta.node_id,
                    DecodedNode {
                        player: meta.player,
                        action_labels: meta.action_labels,
                        freqs,
                    },
                )
                .is_some()
            {
                return Err(format!("duplicate node id '{node_id}'"));
            }
        }

        Ok(Self {
            scenario_id,
            flop,
            starting_pot_chips,
            effective_stack_chips,
            combos,
            nodes,
        })
    }

    pub fn reached_ranges(
        &self,
        scenario: &Scenario,
        flop: [Card; 3],
        action_path: &str,
        turn: Card,
    ) -> Result<ReachedRanges, String> {
        self.validate_header(scenario, flop)?;
        if flop.contains(&turn) {
            return Err(format!("turn card {turn} overlaps the flop"));
        }

        let board_mask = flop.iter().fold(0u64, |mask, &card| mask | (1u64 << card));
        let parsed_ranges = [
            scenario
                .oop_range_str
                .parse::<Range>()
                .map_err(|e| format!("OOP range parse error: {e}"))?,
            scenario
                .ip_range_str
                .parse::<Range>()
                .map_err(|e| format!("IP range parse error: {e}"))?,
        ];
        let mut weights: [Vec<f32>; 2] = std::array::from_fn(|_| Vec::new());
        for player in 0..2 {
            let (hands, initial_weights) = parsed_ranges[player].get_hands_weights(board_mask);
            // FORMAT.mdの自己記述コンボ表とシナリオレンジがずれていたら、戦略を
            // 誤ったコンボへ適用してしまうため即座に止める。
            if hands != self.combos[player] {
                return Err(format!(
                    "scenario range and flop solution combo table differ for player {player}"
                ));
            }
            weights[player] = normalize(initial_weights)?;
        }

        let labels = parse_action_path(action_path)?;
        let mut node_path = Vec::new();
        for label in &labels {
            let node_id = node_path.join("-");
            let node = self
                .nodes
                .get(&node_id)
                .ok_or_else(|| format!("flop solution has no decision node '{node_id}' while following '{action_path}'"))?;
            let action_index = node
                .action_labels
                .iter()
                .position(|candidate| candidate == label)
                .ok_or_else(|| format!("action '{label}' is unavailable at node '{node_id}'"))?;
            let hand_count = self.combos[node.player].len();
            let row_start = action_index * hand_count;
            condition_weights(
                &mut weights[node.player],
                &node.freqs[row_start..row_start + hand_count],
            )?;
            node_path.push(label.clone());
        }

        let mut reached_hands: [Vec<(Card, Card)>; 2] = std::array::from_fn(|_| Vec::new());
        let mut reached_weights: [Vec<f32>; 2] = std::array::from_fn(|_| Vec::new());
        for player in 0..2 {
            (reached_hands[player], reached_weights[player]) =
                filter_blocked_and_normalize(&self.combos[player], &weights[player], turn)?;
        }

        let ranges = [
            Range::from_hands_weights(&reached_hands[0], &reached_weights[0])?,
            Range::from_hands_weights(&reached_hands[1], &reached_weights[1])?,
        ];
        Ok(ReachedRanges {
            ranges,
            combo_counts: [reached_hands[0].len(), reached_hands[1].len()],
        })
    }

    fn validate_header(&self, scenario: &Scenario, flop: [Card; 3]) -> Result<(), String> {
        if self.scenario_id != scenario.scenario_id {
            return Err(format!(
                "scenario mismatch: solution='{}', input='{}'",
                self.scenario_id, scenario.scenario_id
            ));
        }
        if self.flop != flop {
            return Err(format!(
                "flop mismatch: solution={:?}, input={flop:?}",
                self.flop
            ));
        }
        if self.starting_pot_chips != scenario.starting_pot_chips as u32
            || self.effective_stack_chips != scenario.effective_stack_chips as u32
        {
            return Err("pot/stack mismatch between solution and scenario".to_string());
        }
        Ok(())
    }
}

pub fn parse_action_path(action_path: &str) -> Result<Vec<String>, String> {
    if action_path.is_empty() {
        return Err("flop action path must not be empty".to_string());
    }
    if action_path.contains('/') {
        return Err("flop action path must use '-' separators, not '/'".to_string());
    }
    let labels: Vec<String> = action_path.split('-').map(str::to_string).collect();
    if labels.iter().any(String::is_empty) {
        return Err(format!("invalid flop action path '{action_path}'"));
    }
    Ok(labels)
}

fn condition_weights(weights: &mut [f32], action_freqs: &[f32]) -> Result<(), String> {
    if weights.len() != action_freqs.len() {
        return Err("weight/frequency length mismatch".to_string());
    }
    let mut total = 0.0f32;
    for (weight, &freq) in weights.iter_mut().zip(action_freqs) {
        *weight *= freq.max(RANGE_TRACKER_EPSILON);
        total += *weight;
    }
    if total <= 0.0 {
        return Err("all range weights became zero".to_string());
    }
    for weight in weights {
        *weight /= total;
    }
    Ok(())
}

fn normalize(mut weights: Vec<f32>) -> Result<Vec<f32>, String> {
    let total: f32 = weights.iter().sum();
    if total <= 0.0 {
        return Err("range has no positive unblocked combo weights".to_string());
    }
    for weight in &mut weights {
        *weight /= total;
    }
    Ok(weights)
}

fn filter_blocked_and_normalize(
    hands: &[(Card, Card)],
    weights: &[f32],
    turn: Card,
) -> Result<(Vec<(Card, Card)>, Vec<f32>), String> {
    if hands.len() != weights.len() {
        return Err("hand/weight length mismatch".to_string());
    }
    let mut kept_hands = Vec::new();
    let mut kept_weights = Vec::new();
    for (&hand, &weight) in hands.iter().zip(weights) {
        if hand.0 != turn && hand.1 != turn && weight > 0.0 {
            kept_hands.push(hand);
            kept_weights.push(weight);
        }
    }
    Ok((kept_hands, normalize(kept_weights)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::{write_binary, NodeExport, SolutionExport};

    #[test]
    fn decodes_exported_solution_and_conditions_with_app_epsilon() {
        let solution = SolutionExport {
            scenario_id: "test".to_string(),
            flop_card_ids: [0, 5, 10],
            starting_pot_chips: 50,
            effective_stack_chips: 100,
            oop_combos: vec![(1, 2), (3, 4)],
            ip_combos: vec![(6, 7)],
            exploitability_pot_frac: 0.005,
            nodes: vec![NodeExport {
                node_id: "".to_string(),
                player: 0,
                action_labels: vec!["check".to_string(), "bet75".to_string()],
                freq: vec![1.0, 0.0, 0.0, 1.0],
                ev_bb: vec![0.0; 4],
            }],
        };
        let decoded = FlopSolution::from_bytes(&write_binary(&solution)).unwrap();
        let root = decoded.nodes.get("").unwrap();
        assert_eq!(root.action_labels, ["check", "bet75"]);

        let mut weights = vec![0.5, 0.5];
        condition_weights(&mut weights, &root.freqs[..2]).unwrap();
        let expected_first = 1.0 / 1.005;
        assert!((weights[0] - expected_first).abs() < 1e-6);
        assert!((weights.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn rejects_slash_path_separator() {
        assert!(parse_action_path("check/check")
            .unwrap_err()
            .contains("'-' separators"));
        assert_eq!(
            parse_action_path("check-bet33-call").unwrap(),
            ["check", "bet33", "call"]
        );
    }

    #[test]
    fn turn_filter_removes_blocked_combo_and_normalizes() {
        let hands = [(1, 2), (1, 3), (4, 5)];
        let weights = [0.2f32, 0.3, 0.5];
        let (kept_hands, normalized) = filter_blocked_and_normalize(&hands, &weights, 1).unwrap();
        assert_eq!(kept_hands, [(4, 5)]);
        assert_eq!(normalized.len(), 1);
        assert!((normalized.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    }
}
