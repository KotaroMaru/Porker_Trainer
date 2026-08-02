//! P3事前計算パイプラインCLI。
//!
//! 使い方(フロップ解を生成、出荷用):
//!   precompute --scenario <scenario.json> --out <output_dir>
//!     [--flop <カード文字列, 省略時はシナリオ内の全95フロップ>]
//!     [--max-iter 300] [--target-expl 0.003] [--resume]
//!     [--debug-json <path>] (単一フロップ指定時のみ有効)
//!
//! 使い方(P3 Step 5: Rust↔TS突合検証用、ターン部分ゲームをJSON出力):
//!   precompute --scenario <scenario.json> --flop <flop> --turn-subgame <turnCard>
//!     --debug-json <path> [--max-iter 300] [--target-expl 0.003]
//!   (--outは不要、.binは書き出さずJSONのみ出力する)
//!
//! 使い方(P15 S1: フロップ解の経路到達レンジからターン1件を計測):
//!   precompute --scenario <scenario.json> --flop <flop> --flop-path <action-path>
//!     --turn-subgame <turnCard> [--max-iter 500] [--target-expl 0.005]
//!   (フロップ解はpublic/gto/solutionsから自動取得。--flop-solutionで上書き可)
//!
//! 使い方(P15 S2: 49枚のターン解を1バンドルへ出力):
//!   precompute --scenario <scenario.json> --flop <flop> --flop-path <action-path>
//!     --bundle-out <file.bin> [--flop-solution <flop.bin>]
//!     [--max-iter 300] [--target-expl 0.003]
//!
//! 出力: <out>/<scenarioId>/<flop>.bin (FORMAT.md準拠)

mod export;
mod flop_solution;
mod scenario;
mod tree_walk;

use export::{write_binary, write_turn_bundle, TurnBundleSolution};
use postflop_solver::card_to_string;
use scenario::Scenario;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tree_walk::{
    legal_turn_card_ids, solve_scenario_flop, solve_turn_subgame,
    solve_turn_subgame_from_flop_solution, SolveOptions,
};

/// per-flopの収束エビデンス記録(P4 Step0)。出力ディレクトリ直下にmanifest.jsonとして
/// 書き出す。95フロップ全てが目標exploitabilityへ到達したかを事後に確認できるようにする。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
    flop: String,
    expl_pot_frac: f32,
    seconds: f64,
    bytes: usize,
}

fn manifest_path(scenario_out_dir: &Path) -> PathBuf {
    scenario_out_dir.join("manifest.json")
}

fn load_manifest(path: &Path) -> BTreeMap<String, ManifestEntry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let Ok(entries) = serde_json::from_str::<Vec<ManifestEntry>>(&text) else {
        return BTreeMap::new();
    };
    entries.into_iter().map(|e| (e.flop.clone(), e)).collect()
}

fn save_manifest(path: &Path, entries: &BTreeMap<String, ManifestEntry>) {
    let list: Vec<&ManifestEntry> = entries.values().collect();
    let json = serde_json::to_string_pretty(&list).expect("manifest entries must serialize");
    std::fs::write(path, json).unwrap_or_else(|e| panic!("failed to write manifest {path:?}: {e}"));
}

struct Args {
    scenario_path: PathBuf,
    out_dir: Option<PathBuf>,
    flop: Option<String>,
    turn_subgame: Option<String>,
    flop_path: Option<String>,
    flop_solution: Option<PathBuf>,
    bundle_out: Option<PathBuf>,
    max_iterations: u32,
    target_exploitability_pot_frac: f32,
    resume: bool,
    debug_json: Option<PathBuf>,
    print_progress: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut scenario_path = None;
    let mut out_dir = None;
    let mut flop = None;
    let mut turn_subgame = None;
    let mut flop_path = None;
    let mut flop_solution = None;
    let mut bundle_out = None;
    let mut max_iterations = 300u32;
    let mut target_exploitability_pot_frac = 0.003f32;
    let mut resume = false;
    let mut debug_json = None;
    let mut print_progress = false;

    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--scenario" => {
                scenario_path = Some(PathBuf::from(
                    it.next().ok_or("--scenario requires a value")?,
                ))
            }
            "--out" => out_dir = Some(PathBuf::from(it.next().ok_or("--out requires a value")?)),
            "--flop" => flop = Some(it.next().ok_or("--flop requires a value")?),
            "--turn-subgame" => {
                turn_subgame = Some(it.next().ok_or("--turn-subgame requires a value")?)
            }
            "--flop-path" => flop_path = Some(it.next().ok_or("--flop-path requires a value")?),
            "--flop-solution" => {
                flop_solution = Some(PathBuf::from(
                    it.next().ok_or("--flop-solution requires a value")?,
                ))
            }
            "--bundle-out" => {
                bundle_out = Some(PathBuf::from(
                    it.next().ok_or("--bundle-out requires a value")?,
                ))
            }
            "--max-iter" => {
                max_iterations = it
                    .next()
                    .ok_or("--max-iter requires a value")?
                    .parse()
                    .map_err(|e| format!("invalid --max-iter: {e}"))?
            }
            "--target-expl" => {
                target_exploitability_pot_frac = it
                    .next()
                    .ok_or("--target-expl requires a value")?
                    .parse()
                    .map_err(|e| format!("invalid --target-expl: {e}"))?
            }
            "--resume" => resume = true,
            "--progress" => print_progress = true,
            "--debug-json" => {
                debug_json = Some(PathBuf::from(
                    it.next().ok_or("--debug-json requires a value")?,
                ))
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    if turn_subgame.is_some() && flop.is_none() {
        return Err("--turn-subgame requires --flop".to_string());
    }
    if flop_solution.is_some() && flop_path.is_none() {
        return Err("--flop-solution requires --flop-path".to_string());
    }
    if bundle_out.is_some() && turn_subgame.is_some() {
        return Err("--bundle-out and --turn-subgame are mutually exclusive".to_string());
    }
    if bundle_out.is_some() && (flop.is_none() || flop_path.is_none()) {
        return Err("--bundle-out requires both --flop and --flop-path".to_string());
    }
    if flop_path.is_some() && turn_subgame.is_none() && bundle_out.is_none() {
        return Err("--flop-path requires --turn-subgame or --bundle-out".to_string());
    }
    if turn_subgame.is_some() && flop_path.is_none() && debug_json.is_none() {
        return Err("cross-validation --turn-subgame requires --debug-json (or use --flop-path for a benchmark)".to_string());
    }
    if turn_subgame.is_none() && bundle_out.is_none() && out_dir.is_none() {
        return Err(
            "--out is required (unless --turn-subgame or --bundle-out is used)".to_string(),
        );
    }

    Ok(Args {
        scenario_path: scenario_path.ok_or("--scenario is required")?,
        out_dir,
        flop,
        turn_subgame,
        flop_path,
        flop_solution,
        bundle_out,
        max_iterations,
        target_exploitability_pot_frac,
        resume,
        debug_json,
        print_progress,
    })
}

fn default_flop_solution_path(
    scenario_path: &Path,
    scenario_id: &str,
    flop: &str,
) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(scenario_path)
        .map_err(|e| format!("failed to resolve scenario path {scenario_path:?}: {e}"))?;
    let solver_dir = canonical.parent().and_then(Path::parent).ok_or_else(|| {
        format!("scenario path must be inside tools/solver/scenarios: {canonical:?}")
    })?;
    Ok(solver_dir
        .join("../../public/gto/solutions")
        .join(scenario_id)
        .join(format!("{flop}.bin")))
}

fn write_debug_json(sol: &export::SolutionExport, path: &Path) -> Result<(), String> {
    use std::fmt::Write as _;
    // 簡易JSON手書き(serde_jsonのderiveをexport::SolutionExportに追加する代わりに、
    // ここでは検証用途に十分な最小限の手動シリアライズで済ませる)。
    let mut s = String::new();
    write!(s, "{{\"scenarioId\":\"{}\",", sol.scenario_id).unwrap();
    write!(
        s,
        "\"flopCardIds\":[{},{},{}],",
        sol.flop_card_ids[0], sol.flop_card_ids[1], sol.flop_card_ids[2]
    )
    .unwrap();
    write!(
        s,
        "\"startingPotChips\":{},\"effectiveStackChips\":{},",
        sol.starting_pot_chips, sol.effective_stack_chips
    )
    .unwrap();
    let combos_json = |combos: &[(u8, u8)]| -> String {
        let parts: Vec<String> = combos.iter().map(|&(a, b)| format!("[{a},{b}]")).collect();
        format!("[{}]", parts.join(","))
    };
    write!(s, "\"oopCombos\":{},", combos_json(&sol.oop_combos)).unwrap();
    write!(s, "\"ipCombos\":{},", combos_json(&sol.ip_combos)).unwrap();
    write!(s, "\"nodes\":[").unwrap();
    for (i, node) in sol.nodes.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        write!(
            s,
            "{{\"nodeId\":\"{}\",\"player\":{},",
            node.node_id, node.player
        )
        .unwrap();
        let labels_json = node
            .action_labels
            .iter()
            .map(|l| format!("\"{l}\""))
            .collect::<Vec<_>>()
            .join(",");
        write!(s, "\"actionLabels\":[{labels_json}],").unwrap();
        let freq_json = node
            .freq
            .iter()
            .map(|v| format!("{v}"))
            .collect::<Vec<_>>()
            .join(",");
        write!(s, "\"freq\":[{freq_json}],").unwrap();
        let ev_json = node
            .ev_bb
            .iter()
            .map(|v| format!("{v}"))
            .collect::<Vec<_>>()
            .join(",");
        write!(s, "\"evBb\":[{ev_json}]}}").unwrap();
    }
    write!(s, "]}}").unwrap();

    std::fs::write(path, s).map_err(|e| format!("failed to write debug json {path:?}: {e}"))
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    };

    let scenario = Scenario::load(&args.scenario_path).unwrap_or_else(|e| {
        eprintln!("error: {e}");
        std::process::exit(1);
    });

    let solve_opts = SolveOptions {
        max_iterations: args.max_iterations,
        target_exploitability_pot_frac: args.target_exploitability_pot_frac,
        print_progress: args.print_progress,
    };

    if let Some(bundle_out) = &args.bundle_out {
        let flop_str = args.flop.as_ref().expect("checked in parse_args");
        let action_path = args.flop_path.as_ref().expect("checked in parse_args");
        let solution_path = match &args.flop_solution {
            Some(path) => path.clone(),
            None => {
                default_flop_solution_path(&args.scenario_path, &scenario.scenario_id, flop_str)
                    .unwrap_or_else(|e| {
                        eprintln!("error: {e}");
                        std::process::exit(1);
                    })
            }
        };
        let turn_cards = legal_turn_card_ids(flop_str).unwrap_or_else(|e| {
            eprintln!("error parsing flop {flop_str}: {e}");
            std::process::exit(1);
        });
        let started = std::time::Instant::now();
        let mut entries = Vec::with_capacity(turn_cards.len());
        for (index, &turn_card_id) in turn_cards.iter().enumerate() {
            let turn_str = card_to_string(turn_card_id).expect("legal card_id must format");
            let result = solve_turn_subgame_from_flop_solution(
                &scenario,
                flop_str,
                action_path,
                &turn_str,
                &solution_path,
                &solve_opts,
            )
            .unwrap_or_else(|e| {
                eprintln!(
                    "error solving turn bundle {} / {flop_str} / {action_path} / {turn_str}: {e}",
                    scenario.scenario_id
                );
                std::process::exit(1);
            });
            entries.push(TurnBundleSolution {
                turn_card_id,
                solution: result.solution,
            });
            println!(
                "[{}/{}] turn={} elapsed={:.1}s",
                index + 1,
                turn_cards.len(),
                turn_str,
                started.elapsed().as_secs_f64()
            );
        }
        let flop_card_ids = entries
            .first()
            .expect("a valid flop always has 49 legal turns")
            .solution
            .flop_card_ids;
        let bytes = write_turn_bundle(&scenario.scenario_id, flop_card_ids, action_path, &entries)
            .unwrap_or_else(|e| {
                eprintln!("error creating turn bundle: {e}");
                std::process::exit(1);
            });
        if let Some(parent) = bundle_out
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|e| panic!("failed to create {parent:?}: {e}"));
        }
        std::fs::write(bundle_out, &bytes)
            .unwrap_or_else(|e| panic!("failed to write {bundle_out:?}: {e}"));
        println!(
            "turn bundle complete: scenario={} flop={} path={} turns={} bytes={} seconds={:.1}",
            scenario.scenario_id,
            flop_str,
            action_path,
            entries.len(),
            bytes.len(),
            started.elapsed().as_secs_f64()
        );
        return;
    }

    if let Some(turn_str) = &args.turn_subgame {
        let flop_str = args.flop.as_ref().expect("checked in parse_args");
        if let Some(action_path) = &args.flop_path {
            let solution_path = match &args.flop_solution {
                Some(path) => path.clone(),
                None => {
                    default_flop_solution_path(&args.scenario_path, &scenario.scenario_id, flop_str)
                        .unwrap_or_else(|e| {
                            eprintln!("error: {e}");
                            std::process::exit(1);
                        })
                }
            };
            let t0 = std::time::Instant::now();
            let result = solve_turn_subgame_from_flop_solution(
                &scenario,
                flop_str,
                action_path,
                turn_str,
                &solution_path,
                &solve_opts,
            )
            .unwrap_or_else(|e| {
                eprintln!("error solving turn benchmark {} / {flop_str} / {action_path} / {turn_str}: {e}", scenario.scenario_id);
                std::process::exit(1);
            });
            let elapsed = t0.elapsed().as_secs_f64();
            println!(
                "turn benchmark: scenario={} flop={} path={} turn={} nodes={} oop_combos={} ip_combos={} turn_pot_chips={} remaining_stack_chips={} max_iterations={} target_expl={:.3}% pot seconds={:.3} expl={:.6}% pot",
                scenario.scenario_id,
                flop_str,
                action_path,
                turn_str,
                result.solution.nodes.len(),
                result.combo_counts[0],
                result.combo_counts[1],
                result.turn_pot_chips,
                result.remaining_stack_chips,
                args.max_iterations,
                args.target_exploitability_pot_frac * 100.0,
                elapsed,
                result.solution.exploitability_pot_frac * 100.0,
            );
            if let Some(debug_path) = &args.debug_json {
                write_debug_json(&result.solution, debug_path).unwrap_or_else(|e| {
                    eprintln!("error writing debug json: {e}");
                    std::process::exit(1);
                });
            }
            return;
        }

        let debug_path = args.debug_json.as_ref().expect("checked in parse_args");
        let solution = solve_turn_subgame(&scenario, flop_str, turn_str, &solve_opts)
            .unwrap_or_else(|e| {
                eprintln!(
                    "error solving turn subgame {} / {flop_str}{turn_str}: {e}",
                    scenario.scenario_id
                );
                std::process::exit(1);
            });
        println!("turn subgame solved: {} nodes", solution.nodes.len());
        write_debug_json(&solution, debug_path).unwrap_or_else(|e| {
            eprintln!("error writing debug json: {e}");
            std::process::exit(1);
        });
        return;
    }

    let out_dir = args.out_dir.as_ref().expect("checked in parse_args");
    let flops: Vec<String> = match &args.flop {
        Some(f) => vec![f.clone()],
        None => scenario.flops.clone(),
    };

    let scenario_out_dir = out_dir.join(&scenario.scenario_id);
    std::fs::create_dir_all(&scenario_out_dir).expect("failed to create output directory");
    let manifest_file = manifest_path(&scenario_out_dir);
    let mut manifest = load_manifest(&manifest_file);

    let total = flops.len();
    for (i, flop_str) in flops.iter().enumerate() {
        let out_path = scenario_out_dir.join(format!("{flop_str}.bin"));
        // manifest記載済み(=最終exploitabilityを記録済み)のフロップのみスキップする。
        // ファイル存在だけで判定すると、古い収束基準で書かれた.binが残っている場合に
        // 再計算せず古いデータのまま放置してしまう(2026-07-06、500反復バッチが原因不明で
        // 中断した際に発覚。中断前の古い200反復.binが95件とも残っていたため)。
        if args.resume && manifest.contains_key(flop_str) {
            println!("[{}/{total}] skip (exists): {flop_str}", i + 1);
            continue;
        }

        let t0 = std::time::Instant::now();
        let solution = solve_scenario_flop(&scenario, flop_str, &solve_opts).unwrap_or_else(|e| {
            eprintln!("error solving {} / {flop_str}: {e}", scenario.scenario_id);
            std::process::exit(1);
        });
        let elapsed = t0.elapsed();

        let bytes = write_binary(&solution);
        std::fs::write(&out_path, &bytes)
            .unwrap_or_else(|e| panic!("failed to write {out_path:?}: {e}"));

        println!(
            "[{}/{total}] {} / {flop_str}: {} nodes, {} bytes, {:.1}s, expl={:.3}% pot",
            i + 1,
            scenario.scenario_id,
            solution.nodes.len(),
            bytes.len(),
            elapsed.as_secs_f64(),
            solution.exploitability_pot_frac * 100.0,
        );

        manifest.insert(
            flop_str.clone(),
            ManifestEntry {
                flop: flop_str.clone(),
                expl_pot_frac: solution.exploitability_pot_frac,
                seconds: elapsed.as_secs_f64(),
                bytes: bytes.len(),
            },
        );
        save_manifest(&manifest_file, &manifest);

        if let Some(debug_path) = &args.debug_json {
            write_debug_json(&solution, debug_path).unwrap_or_else(|e| {
                eprintln!("error writing debug json: {e}");
                std::process::exit(1);
            });
        }
    }
}
