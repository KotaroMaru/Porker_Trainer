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
//! 出力: <out>/<scenarioId>/<flop>.bin (FORMAT.md準拠)

mod export;
mod scenario;
mod tree_walk;

use export::write_binary;
use scenario::Scenario;
use std::path::{Path, PathBuf};
use tree_walk::{solve_scenario_flop, solve_turn_subgame, SolveOptions};

struct Args {
    scenario_path: PathBuf,
    out_dir: Option<PathBuf>,
    flop: Option<String>,
    turn_subgame: Option<String>,
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
    let mut max_iterations = 300u32;
    let mut target_exploitability_pot_frac = 0.003f32;
    let mut resume = false;
    let mut debug_json = None;
    let mut print_progress = false;

    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--scenario" => scenario_path = Some(PathBuf::from(it.next().ok_or("--scenario requires a value")?)),
            "--out" => out_dir = Some(PathBuf::from(it.next().ok_or("--out requires a value")?)),
            "--flop" => flop = Some(it.next().ok_or("--flop requires a value")?),
            "--turn-subgame" => turn_subgame = Some(it.next().ok_or("--turn-subgame requires a value")?),
            "--max-iter" => {
                max_iterations = it.next().ok_or("--max-iter requires a value")?.parse().map_err(|e| format!("invalid --max-iter: {e}"))?
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
            "--debug-json" => debug_json = Some(PathBuf::from(it.next().ok_or("--debug-json requires a value")?)),
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    if turn_subgame.is_some() && (flop.is_none() || debug_json.is_none()) {
        return Err("--turn-subgame requires both --flop and --debug-json".to_string());
    }
    if turn_subgame.is_none() && out_dir.is_none() {
        return Err("--out is required (unless --turn-subgame is used)".to_string());
    }

    Ok(Args {
        scenario_path: scenario_path.ok_or("--scenario is required")?,
        out_dir,
        flop,
        turn_subgame,
        max_iterations,
        target_exploitability_pot_frac,
        resume,
        debug_json,
        print_progress,
    })
}

fn write_debug_json(sol: &export::SolutionExport, path: &Path) -> Result<(), String> {
    use std::fmt::Write as _;
    // 簡易JSON手書き(serde_jsonのderiveをexport::SolutionExportに追加する代わりに、
    // ここでは検証用途に十分な最小限の手動シリアライズで済ませる)。
    let mut s = String::new();
    write!(s, "{{\"scenarioId\":\"{}\",", sol.scenario_id).unwrap();
    write!(s, "\"flopCardIds\":[{},{},{}],", sol.flop_card_ids[0], sol.flop_card_ids[1], sol.flop_card_ids[2]).unwrap();
    write!(s, "\"startingPotChips\":{},\"effectiveStackChips\":{},", sol.starting_pot_chips, sol.effective_stack_chips).unwrap();
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
        write!(s, "{{\"nodeId\":\"{}\",\"player\":{},", node.node_id, node.player).unwrap();
        let labels_json = node.action_labels.iter().map(|l| format!("\"{l}\"")).collect::<Vec<_>>().join(",");
        write!(s, "\"actionLabels\":[{labels_json}],").unwrap();
        let freq_json = node.freq.iter().map(|v| format!("{v}")).collect::<Vec<_>>().join(",");
        write!(s, "\"freq\":[{freq_json}],").unwrap();
        let ev_json = node.ev_bb.iter().map(|v| format!("{v}")).collect::<Vec<_>>().join(",");
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

    if let Some(turn_str) = &args.turn_subgame {
        let flop_str = args.flop.as_ref().expect("checked in parse_args");
        let debug_path = args.debug_json.as_ref().expect("checked in parse_args");
        let solution = solve_turn_subgame(&scenario, flop_str, turn_str, &solve_opts).unwrap_or_else(|e| {
            eprintln!("error solving turn subgame {} / {flop_str}{turn_str}: {e}", scenario.scenario_id);
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

    let total = flops.len();
    for (i, flop_str) in flops.iter().enumerate() {
        let out_path = scenario_out_dir.join(format!("{flop_str}.bin"));
        if args.resume && out_path.exists() {
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
        std::fs::write(&out_path, &bytes).unwrap_or_else(|e| panic!("failed to write {out_path:?}: {e}"));

        println!(
            "[{}/{total}] {} / {flop_str}: {} nodes, {} bytes, {:.1}s",
            i + 1,
            scenario.scenario_id,
            solution.nodes.len(),
            bytes.len(),
            elapsed.as_secs_f64()
        );

        if let Some(debug_path) = &args.debug_json {
            write_debug_json(&solution, debug_path).unwrap_or_else(|e| {
                eprintln!("error writing debug json: {e}");
                std::process::exit(1);
            });
        }
    }
}
