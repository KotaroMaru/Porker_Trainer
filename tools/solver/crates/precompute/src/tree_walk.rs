//! フロップ部分ゲームの構築・ソルブ・抽出。
//!
//! postflop-solverのデフォルトのアクションツリーは、レイズに直面するたびに
//! 何段でもサイズド再レイズ("55%, a")を提案し続ける。TS側の抽象
//! (src/gto/tree/actionTree.ts, 2026-07-04仕様)は「レイズに直面した側は
//! fold/call/allinの3択のみ(サイズドの再レイズは1段目のみ)」なので、
//! ActionTree構築後にremove_lineで2段目以降のサイズド再レイズを刈り取り、
//! TS側と構造的に一致させる(FORMAT.md参照)。

use crate::export::{NodeExport, SolutionExport};
use crate::flop_solution::{parse_action_path, FlopSolution};
use crate::scenario::Scenario;
use postflop_solver::*;
use std::path::Path;

pub struct SolveOptions {
    pub max_iterations: u32,
    /// pot比(例: 0.003 = 0.3% pot)。内部でチップ絶対値に変換する。
    pub target_exploitability_pot_frac: f32,
    pub print_progress: bool,
}

fn build_tree_config(starting_pot_chips: i32, effective_stack_chips: i32) -> TreeConfig {
    let bet_sizes =
        BetSizeOptions::try_from(("33%, 75%, a", "55%, a")).expect("bet size string must parse");
    TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: starting_pot_chips,
        effective_stack: effective_stack_chips,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        turn_bet_sizes: [bet_sizes.clone(), bet_sizes.clone()],
        river_bet_sizes: [bet_sizes.clone(), bet_sizes],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 0.0,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    }
}

/// 未加工のActionTreeを1本走査し、「レイズに直面した側がさらにサイズドレイズで
/// 再レイズできてしまう」ラインを列挙する(除去対象そのものを返す。除去対象の枝は
/// 探索を打ち切るため、その内部の孫ラインは列挙不要)。
///
/// 注意: ActionTreeのplay()/available_actions()はチャンスノードを自動スキップして
/// 「次の街の開始アクション一覧」を返す(ラインにチャンスアクションは現れない)。
/// そのためis_chance_node()がtrueの地点では、決断ノードと同様に**全アクション**を
/// 反復しつつレイズ段数カウンタだけを0にリセットする必要がある。かつて
/// 「チャンスの代表1枚だけ辿る」つもりでactions[0]のみ再帰する誤実装になっており、
/// ターン/リバーがベットで始まるライン配下の再レイズが刈り残されるバグがあった
/// (P0-P3レビューで発見・修正済み。detects_no_raise_after_raise_in_full_treeが回帰網)。
fn discover_prune_lines(config: &TreeConfig) -> Vec<Vec<Action>> {
    let mut tree = ActionTree::new(config.clone()).expect("initial ActionTree must build");
    let mut out = Vec::new();
    let mut path = Vec::new();
    discover_prune_lines_recursive(&mut tree, &mut path, 0, &mut out);
    out
}

fn discover_prune_lines_recursive(
    tree: &mut ActionTree,
    path: &mut Vec<Action>,
    raises_this_street: usize,
    out: &mut Vec<Vec<Action>>,
) {
    if tree.is_terminal_node() {
        return;
    }
    // 新しい街に入る(チャンス通過)場合はレイズ段数をリセットする。
    // 街の開始アクションはCheck/Bet/AllInのみでRaiseは現れないため、
    // このリセットと下の決断ノード処理だけで全ラインを正しく走査できる。
    let next_street_reset = tree.is_chance_node();

    let actions = tree.available_actions().to_vec();
    for action in actions {
        let is_raise = matches!(action, Action::Raise(_));
        let raises_before = if next_street_reset {
            0
        } else {
            raises_this_street
        };
        if raises_before >= 1 && is_raise {
            let mut line = path.clone();
            line.push(action);
            out.push(line);
            continue; // 除去対象。これ以上辿らない。
        }
        tree.play(action).expect("action must be playable");
        path.push(action);
        let next_raises = if is_raise {
            raises_before + 1
        } else {
            raises_before
        };
        discover_prune_lines_recursive(tree, path, next_raises, out);
        path.pop();
        tree.undo().expect("undo must succeed");
    }
}

/// TS側の抽象(fold/call/allinの3択、サイズド再レイズは1段目のみ)に合わせて刈り込んだ
/// ActionTreeを構築する。
fn build_pruned_action_tree(config: TreeConfig) -> ActionTree {
    let prune_lines = discover_prune_lines(&config);
    let mut tree = ActionTree::new(config).expect("ActionTree must build");
    for line in &prune_lines {
        tree.remove_line(line)
            .unwrap_or_else(|e| panic!("failed to remove line {line:?}: {e}"));
    }
    tree
}

/// ポット比からベットのラベル(bet33/bet75)を決める。33%/75%どちらに近いかで判定する。
fn bet_label(amount: i32, pot_before: i32) -> String {
    if pot_before <= 0 {
        return "bet33".to_string();
    }
    let ratio = amount as f64 / pot_before as f64;
    if (ratio - 0.33).abs() <= (ratio - 0.75).abs() {
        "bet33".to_string()
    } else {
        "bet75".to_string()
    }
}

fn action_label(action: Action, pot_before: i32) -> String {
    match action {
        Action::Fold => "fold".to_string(),
        Action::Check => "check".to_string(),
        Action::Call => "call".to_string(),
        Action::AllIn(_) => "allin".to_string(),
        Action::Raise(_) => "raise55".to_string(),
        Action::Bet(amount) => bet_label(amount, pot_before),
        other => panic!("unexpected action at flop-level decision node: {other:?}"),
    }
}

/// フロップ街の決断ノードのみをDFSで収集し、strategy/EVを抽出する。
/// チャンスノード(ターンを配る)に到達したら、その配下は探索しない
/// (ターン以降はTS側のライブソルブが担当するため、フロップ解には含めない)。
fn collect_flop_nodes(
    game: &mut PostFlopGame,
    node_id_path: &mut Vec<String>,
    out: &mut Vec<NodeExport>,
) {
    if game.is_terminal_node() || game.is_chance_node() {
        return;
    }
    // strategy()/expected_values_detail()は、ノードを移動(play/apply_history)する
    // たびにcache_normalized_weights()で再キャッシュしないと"Normalized weights are
    // not cached"でpanicする。ルートで1回呼ぶだけでは足りない。
    game.cache_normalized_weights();

    let player = game.current_player() as u8;
    let actions = game.available_actions();
    let starting_pot = game.tree_config().starting_pot;
    let total_bet = game.total_bet_amount();
    let pot_before = starting_pot + total_bet[0] + total_bet[1];

    let action_labels: Vec<String> = actions
        .iter()
        .map(|&a| action_label(a, pot_before))
        .collect();

    let strategy = game.strategy();
    let ev_detail = game.expected_values_detail(player as usize);

    let node_id = node_id_path.join("-");
    out.push(NodeExport {
        node_id,
        player,
        action_labels: action_labels.clone(),
        freq: strategy,
        ev_bb: ev_detail.iter().map(|&v| v / 10.0).collect(), // チップ(0.1bb単位) → bb
    });

    let saved_history = game.history().to_vec();
    for (i, label) in action_labels.iter().enumerate() {
        game.play(i);
        node_id_path.push(label.clone());
        collect_flop_nodes(game, node_id_path, out);
        node_id_path.pop();
        game.apply_history(&saved_history);
    }
}

/// ターン部分ゲームの決断ノードをDFSで収集する。collect_flop_nodesと同様、
/// チャンスノード(リバー配札)に到達したらそこで打ち切る: TS側のchanceValueは
/// 全リバーカードを平均した値を親ノードへ伝播するため、両実装の比較対象は
/// 「配札前(=ターンの決断ノード群)のEV/戦略」のみで十分であり、配札後の
/// 個々の(カードごとに異なる)決断木まで辿る必要はない。
/// P3 Step 5のRust↔TS突合専用(出荷用.binには使わない、JSON出力用)。
fn collect_all_decision_nodes(
    game: &mut PostFlopGame,
    node_id_path: &mut Vec<String>,
    out: &mut Vec<NodeExport>,
) {
    if game.is_terminal_node() || game.is_chance_node() {
        return;
    }
    game.cache_normalized_weights();

    let player = game.current_player() as u8;
    let actions = game.available_actions();
    let starting_pot = game.tree_config().starting_pot;
    let total_bet = game.total_bet_amount();
    let pot_before = starting_pot + total_bet[0] + total_bet[1];

    let action_labels: Vec<String> = actions
        .iter()
        .map(|&a| action_label(a, pot_before))
        .collect();
    let strategy = game.strategy();
    let ev_detail = game.expected_values_detail(player as usize);

    let node_id = node_id_path.join("-");
    out.push(NodeExport {
        node_id,
        player,
        action_labels: action_labels.clone(),
        freq: strategy,
        ev_bb: ev_detail.iter().map(|&v| v / 10.0).collect(),
    });

    let saved_history = game.history().to_vec();
    for (i, label) in action_labels.iter().enumerate() {
        game.play(i);
        node_id_path.push(label.clone());
        collect_all_decision_nodes(game, node_id_path, out);
        node_id_path.pop();
        game.apply_history(&saved_history);
    }
}

/// P3 Step 5: Rust↔TS突合検証用。ターンカード確定後の部分ゲーム(ターン+リバー)を
/// 解き、ルート(ターンの最初の決断)直下の決断ノードの戦略/EVをJSON出力する。
/// pot/実効スタックはシナリオのフロップ開始時点の値をそのまま使う
/// (「フロップはチェックスルーで進行した」という前提。突合フィクスチャの設計)。
pub fn solve_turn_subgame(
    scenario: &Scenario,
    flop_str: &str,
    turn_str: &str,
    opts: &SolveOptions,
) -> Result<SolutionExport, String> {
    let flop = flop_from_str(flop_str)?;
    let turn = card_from_str(turn_str)?;
    let oop_range = scenario
        .oop_range_str
        .parse::<Range>()
        .map_err(|e| format!("OOP range parse error: {e}"))?;
    let ip_range = scenario
        .ip_range_str
        .parse::<Range>()
        .map_err(|e| format!("IP range parse error: {e}"))?;

    let card_config = CardConfig {
        range: [oop_range, ip_range],
        flop,
        turn,
        river: NOT_DEALT,
    };

    let mut tree_config =
        build_tree_config(scenario.starting_pot_chips, scenario.effective_stack_chips);
    tree_config.initial_state = BoardState::Turn;
    let action_tree = build_pruned_action_tree(tree_config);
    let mut game = PostFlopGame::with_config(card_config, action_tree)?;
    game.allocate_memory(true);

    let target_expl_chips =
        scenario.starting_pot_chips as f32 * opts.target_exploitability_pot_frac;
    let final_expl_chips = solve(
        &mut game,
        opts.max_iterations,
        target_expl_chips,
        opts.print_progress,
    );

    game.back_to_root();

    let mut nodes = Vec::new();
    let mut path = Vec::new();
    collect_all_decision_nodes(&mut game, &mut path, &mut nodes);

    let oop_combos: Vec<(u8, u8)> = game.private_cards(0).iter().map(|&(a, b)| (a, b)).collect();
    let ip_combos: Vec<(u8, u8)> = game.private_cards(1).iter().map(|&(a, b)| (a, b)).collect();

    Ok(SolutionExport {
        scenario_id: scenario.scenario_id.clone(),
        flop_card_ids: flop,
        starting_pot_chips: scenario.starting_pot_chips as u32,
        effective_stack_chips: scenario.effective_stack_chips as u32,
        oop_combos,
        ip_combos,
        exploitability_pot_frac: final_expl_chips / scenario.starting_pot_chips as f32,
        nodes,
    })
}

pub struct TurnBenchmarkResult {
    pub solution: SolutionExport,
    pub turn_pot_chips: i32,
    pub remaining_stack_chips: i32,
    pub combo_counts: [usize; 2],
}

/// フロップ3枚だけを除外した、FORMAT.md Section 7の合法ターンcard_id一覧。
/// ヒーローの具体的な手札は解の生成時点では未知なので除外しない。
pub fn legal_turn_card_ids(flop_str: &str) -> Result<Vec<u8>, String> {
    let flop = flop_from_str(flop_str)?;
    Ok((0u8..52).filter(|card| !flop.contains(card)).collect())
}

/// 既存フロップ解の戦略でaction_pathを辿った到達レンジを初期レンジとし、
/// ターンカード確定後の部分ゲームを1件だけ構築・ソルブする。
pub fn solve_turn_subgame_from_flop_solution(
    scenario: &Scenario,
    flop_str: &str,
    action_path: &str,
    turn_str: &str,
    flop_solution_path: &Path,
    opts: &SolveOptions,
) -> Result<TurnBenchmarkResult, String> {
    let flop = flop_from_str(flop_str)?;
    let turn = card_from_str(turn_str)?;
    let (turn_pot_chips, remaining_stack_chips) =
        turn_state_after_flop_path(scenario, action_path)?;
    let flop_solution = FlopSolution::load(flop_solution_path)?;
    let reached = flop_solution.reached_ranges(scenario, flop, action_path, turn)?;

    let card_config = CardConfig {
        range: reached.ranges,
        flop,
        turn,
        river: NOT_DEALT,
    };
    let mut tree_config = build_tree_config(turn_pot_chips, remaining_stack_chips);
    tree_config.initial_state = BoardState::Turn;
    let action_tree = build_pruned_action_tree(tree_config);
    let mut game = PostFlopGame::with_config(card_config, action_tree)?;
    game.allocate_memory(true);

    let target_expl_chips = turn_pot_chips as f32 * opts.target_exploitability_pot_frac;
    let final_expl_chips = solve(
        &mut game,
        opts.max_iterations,
        target_expl_chips,
        opts.print_progress,
    );

    game.back_to_root();
    let mut nodes = Vec::new();
    let mut path = Vec::new();
    collect_all_decision_nodes(&mut game, &mut path, &mut nodes);
    let oop_combos = game.private_cards(0).to_vec();
    let ip_combos = game.private_cards(1).to_vec();

    Ok(TurnBenchmarkResult {
        solution: SolutionExport {
            scenario_id: scenario.scenario_id.clone(),
            flop_card_ids: flop,
            starting_pot_chips: turn_pot_chips as u32,
            effective_stack_chips: remaining_stack_chips as u32,
            oop_combos,
            ip_combos,
            exploitability_pot_frac: final_expl_chips / turn_pot_chips as f32,
            nodes,
        },
        turn_pot_chips,
        remaining_stack_chips,
        combo_counts: reached.combo_counts,
    })
}

fn turn_state_after_flop_path(
    scenario: &Scenario,
    action_path: &str,
) -> Result<(i32, i32), String> {
    let config = build_tree_config(scenario.starting_pot_chips, scenario.effective_stack_chips);
    let mut tree = build_pruned_action_tree(config);
    for label in parse_action_path(action_path)? {
        if tree.is_chance_node() || tree.is_terminal_node() {
            return Err(format!(
                "flop path continues after the street ended, before action '{label}'"
            ));
        }
        let total_bet = tree.total_bet_amount();
        let pot_before = scenario.starting_pot_chips + total_bet[0] + total_bet[1];
        let matches: Vec<Action> = tree
            .available_actions()
            .iter()
            .copied()
            .filter(|&action| action_label(action, pot_before) == label)
            .collect();
        let action = match matches.as_slice() {
            [action] => *action,
            [] => {
                return Err(format!(
                    "action '{label}' is unavailable after history {:?}",
                    tree.history()
                ))
            }
            _ => {
                return Err(format!(
                    "action label '{label}' is ambiguous after history {:?}",
                    tree.history()
                ))
            }
        };
        tree.play(action)?;
    }
    if !tree.is_chance_node() {
        return Err(format!(
            "flop path '{action_path}' does not end at a turn deal"
        ));
    }
    let total_bet = tree.total_bet_amount();
    if total_bet[0] != total_bet[1] {
        return Err(format!(
            "flop path ended with unmatched bets: {total_bet:?}"
        ));
    }
    let turn_pot = scenario.starting_pot_chips + total_bet[0] + total_bet[1];
    let remaining_stack = scenario.effective_stack_chips - total_bet[0];
    if remaining_stack <= 0 {
        return Err("flop path leaves no stack for a turn decision subgame".to_string());
    }
    Ok((turn_pot, remaining_stack))
}

pub fn solve_scenario_flop(
    scenario: &Scenario,
    flop_str: &str,
    opts: &SolveOptions,
) -> Result<SolutionExport, String> {
    let flop = flop_from_str(flop_str)?;
    let oop_range = scenario
        .oop_range_str
        .parse::<Range>()
        .map_err(|e| format!("OOP range parse error: {e}"))?;
    let ip_range = scenario
        .ip_range_str
        .parse::<Range>()
        .map_err(|e| format!("IP range parse error: {e}"))?;

    let card_config = CardConfig {
        range: [oop_range, ip_range],
        flop,
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };

    let tree_config =
        build_tree_config(scenario.starting_pot_chips, scenario.effective_stack_chips);
    let action_tree = build_pruned_action_tree(tree_config);
    let mut game = PostFlopGame::with_config(card_config, action_tree)?;

    // 圧縮ストレージ(16bit+スケール)を使う。フル幅レンジ×flop~river全木の非圧縮
    // メモリは実測30GB超に達し、32GB機でもスワップして著しく遅くなることを確認した
    // (1反復16秒→スワップで実質使い物にならない)。圧縮で約半分(実測17.5GB)まで
    // 下がりスワップを回避できるため、速度精度のトレードオフより優先する。
    game.allocate_memory(true);

    let target_expl_chips =
        scenario.starting_pot_chips as f32 * opts.target_exploitability_pot_frac;
    let final_expl_chips = solve(
        &mut game,
        opts.max_iterations,
        target_expl_chips,
        opts.print_progress,
    );

    game.back_to_root();
    game.cache_normalized_weights();

    let mut nodes = Vec::new();
    let mut path = Vec::new();
    collect_flop_nodes(&mut game, &mut path, &mut nodes);

    let oop_combos: Vec<(u8, u8)> = game.private_cards(0).iter().map(|&(a, b)| (a, b)).collect();
    let ip_combos: Vec<(u8, u8)> = game.private_cards(1).iter().map(|&(a, b)| (a, b)).collect();

    Ok(SolutionExport {
        scenario_id: scenario.scenario_id.clone(),
        flop_card_ids: flop,
        starting_pot_chips: scenario.starting_pot_chips as u32,
        effective_stack_chips: scenario.effective_stack_chips as u32,
        exploitability_pot_frac: final_expl_chips / scenario.starting_pot_chips as f32,
        oop_combos,
        ip_combos,
        nodes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::{write_binary, write_turn_bundle, TurnBundleSolution};

    fn test_scenario() -> Scenario {
        Scenario {
            scenario_id: "test".to_string(),
            label: "test".to_string(),
            oop_position: "BB".to_string(),
            ip_position: "BTN".to_string(),
            oop_range_str: "AA".to_string(),
            ip_range_str: "KK".to_string(),
            starting_pot_chips: 55,
            effective_stack_chips: 975,
            flops: Vec::new(),
        }
    }

    #[test]
    fn derives_turn_pot_and_stack_from_flop_path() {
        let scenario = test_scenario();
        assert_eq!(
            turn_state_after_flop_path(&scenario, "check-check").unwrap(),
            (55, 975)
        );
        // 75% of 55 rounds to 41 chips; both players contribute 41 after the call.
        assert_eq!(
            turn_state_after_flop_path(&scenario, "bet75-call").unwrap(),
            (137, 934)
        );
        assert!(turn_state_after_flop_path(&scenario, "check/bet33/call").is_err());
    }

    #[test]
    fn legal_turn_cards_are_unique_sorted_and_exclude_only_the_flop() {
        let flop = flop_from_str("2c3d4h").unwrap();
        let cards = legal_turn_card_ids("2c3d4h").unwrap();
        assert_eq!(cards.len(), 49);
        assert!(cards.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            cards
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            49
        );
        assert!(flop.iter().all(|card| !cards.contains(card)));
        assert_eq!(cards.iter().filter(|card| !flop.contains(card)).count(), 49);
    }

    #[test]
    fn solved_turn_subgames_are_preserved_in_bundle_blobs() {
        let scenario = Scenario {
            starting_pot_chips: 10,
            effective_stack_chips: 6,
            ..test_scenario()
        };
        let flop = flop_from_str("2c3d4h").unwrap();
        let board_mask = flop.iter().fold(0u64, |mask, &card| mask | (1u64 << card));
        let oop_combos = scenario
            .oop_range_str
            .parse::<Range>()
            .unwrap()
            .get_hands_weights(board_mask)
            .0;
        let ip_combos = scenario
            .ip_range_str
            .parse::<Range>()
            .unwrap()
            .get_hands_weights(board_mask)
            .0;
        let flop_solution = SolutionExport {
            scenario_id: scenario.scenario_id.clone(),
            flop_card_ids: flop,
            starting_pot_chips: scenario.starting_pot_chips as u32,
            effective_stack_chips: scenario.effective_stack_chips as u32,
            oop_combos: oop_combos.clone(),
            ip_combos: ip_combos.clone(),
            exploitability_pot_frac: 0.0,
            nodes: vec![
                NodeExport {
                    node_id: "".to_string(),
                    player: 0,
                    action_labels: vec!["check".to_string()],
                    freq: vec![1.0; oop_combos.len()],
                    ev_bb: vec![0.0; oop_combos.len()],
                },
                NodeExport {
                    node_id: "check".to_string(),
                    player: 1,
                    action_labels: vec!["check".to_string()],
                    freq: vec![1.0; ip_combos.len()],
                    ev_bb: vec![0.0; ip_combos.len()],
                },
            ],
        };
        let temp_path = std::env::temp_dir().join(format!(
            "poker-trainer-turn-bundle-{}.bin",
            std::process::id()
        ));
        std::fs::write(&temp_path, write_binary(&flop_solution)).unwrap();

        let opts = SolveOptions {
            max_iterations: 1,
            target_exploitability_pot_frac: 1.0,
            print_progress: false,
        };
        let mut entries = Vec::new();
        for turn_card_id in [16u8, 21u8] {
            let turn = card_to_string(turn_card_id).unwrap();
            let result = solve_turn_subgame_from_flop_solution(
                &scenario,
                "2c3d4h",
                "check-check",
                &turn,
                &temp_path,
                &opts,
            )
            .unwrap();
            // 各handについてaction頻度合計=1。浮動小数点許容誤差を明示する。
            for node in &result.solution.nodes {
                let hand_count = if node.player == 0 {
                    result.solution.oop_combos.len()
                } else {
                    result.solution.ip_combos.len()
                };
                for hand in 0..hand_count {
                    let sum: f32 = (0..node.action_labels.len())
                        .map(|action| node.freq[action * hand_count + hand])
                        .sum();
                    assert!(
                        (sum - 1.0).abs() <= 1e-5,
                        "strategy frequencies must normalize"
                    );
                }
            }
            entries.push(TurnBundleSolution {
                turn_card_id,
                solution: result.solution,
            });
        }
        let expected_blobs: Vec<Vec<u8>> = entries
            .iter()
            .map(|entry| write_binary(&entry.solution))
            .collect();
        let bundle = write_turn_bundle("test", flop, "check-check", &entries).unwrap();
        std::fs::remove_file(&temp_path).unwrap();

        let header_len = 4 + 1 + 1 + "test".len() + 3 + 1 + "check-check".len() + 1;
        let body_start = header_len + entries.len() * 9;
        for (index, expected) in expected_blobs.iter().enumerate() {
            let index_start = header_len + index * 9;
            let offset =
                u32::from_le_bytes(bundle[index_start + 1..index_start + 5].try_into().unwrap())
                    as usize;
            let length =
                u32::from_le_bytes(bundle[index_start + 5..index_start + 9].try_into().unwrap())
                    as usize;
            assert_eq!(length, expected.len());
            assert_eq!(
                &bundle[body_start + offset..body_start + offset + length],
                expected
            );
        }
    }

    /// 浅いスタック(pot=10,stack=6)のツリーで、2段目のサイズド再レイズが
    /// 刈り取られていること(fold/call/allinの3択になっていること)を確認する。
    #[test]
    fn prunes_second_level_sized_raise() {
        let config = build_tree_config(10, 6);
        let tree = build_pruned_action_tree(config);
        // fold/call/allinの3択ノードが少なくとも1つ存在することを確認する
        // (rootから2段以上ベット/レイズが入るラインを手動で辿る)
        let mut t = tree;
        // ルート(OOPの最初の決断: check/bet系)からbet系アクションを辿る
        let root_actions = t.available_actions().to_vec();
        let bet_action = root_actions
            .iter()
            .find(|a| matches!(a, Action::Bet(_) | Action::AllIn(_)))
            .copied()
            .expect("root should offer a bet action");
        t.play(bet_action).unwrap();
        let facing_actions = t.available_actions().to_vec();
        let raise_action = facing_actions
            .iter()
            .find(|a| matches!(a, Action::Raise(_)))
            .copied();
        if let Some(raise_action) = raise_action {
            t.play(raise_action).unwrap();
            let after_raise_actions = t.available_actions().to_vec();
            let has_sized_raise = after_raise_actions
                .iter()
                .any(|a| matches!(a, Action::Raise(_)));
            assert!(
                !has_sized_raise,
                "sized re-raise should have been pruned, got {after_raise_actions:?}"
            );
        }
    }

    /// 刈り込み後の木を(チャンス跨ぎ含めて)全ライン走査し、
    /// 「同一街内でRaiseの後に再びRaiseが現れるライン」がゼロであることを確認する。
    /// かつてdiscover_prune_lines_recursiveのチャンスノード分岐がactions[0]しか
    /// 探索せず、ターン/リバーのベット開始ライン配下の再レイズが刈り残される
    /// バグがあった(浅スタック+フロップのみの旧テストでは検出不能だった)。
    /// 実寸のBTN vs BB SRP構成(pot55/stack975、0.1bb単位チップ)で全域を検証する。
    #[test]
    fn detects_no_raise_after_raise_in_full_tree() {
        fn walk(tree: &mut ActionTree, raises_this_street: usize, count: &mut usize) {
            if tree.is_terminal_node() {
                return;
            }
            let raises = if tree.is_chance_node() {
                0
            } else {
                raises_this_street
            };
            let actions = tree.available_actions().to_vec();
            for action in actions {
                let is_raise = matches!(action, Action::Raise(_));
                assert!(
                    !(raises >= 1 && is_raise),
                    "sized raise after a raise survived pruning: history={:?} action={action:?}",
                    tree.history()
                );
                tree.play(action).unwrap();
                *count += 1;
                walk(tree, if is_raise { raises + 1 } else { raises }, count);
                tree.undo().unwrap();
            }
        }

        let config = build_tree_config(55, 975);
        let mut tree = build_pruned_action_tree(config);
        let mut visited = 0usize;
        walk(&mut tree, 0, &mut visited);
        assert!(
            visited > 100,
            "tree walk should cover a nontrivial number of lines, got {visited}"
        );
    }
}
