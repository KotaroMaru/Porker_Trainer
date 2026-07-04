//! tools/gen-solver-scenarios.mjs が生成するシナリオJSONのserde表現。
//! フィールドはFORMAT.md セクション5と完全に一致させること。

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Scenario {
    pub scenario_id: String,
    #[allow(dead_code)]
    pub label: String,
    #[allow(dead_code)]
    pub oop_position: String,
    #[allow(dead_code)]
    pub ip_position: String,
    pub oop_range_str: String,
    pub ip_range_str: String,
    pub starting_pot_chips: i32,
    pub effective_stack_chips: i32,
    pub flops: Vec<String>,
}

impl Scenario {
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("failed to read {path:?}: {e}"))?;
        // JSONはcamelCaseキー(scenarioId等)なので、serdeのrename_allでマッピングする。
        Self::from_camel_case_json(&text)
    }

    fn from_camel_case_json(text: &str) -> Result<Self, String> {
        #[derive(Debug, Clone, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Raw {
            scenario_id: String,
            label: String,
            oop_position: String,
            ip_position: String,
            oop_range_str: String,
            ip_range_str: String,
            starting_pot_chips: i32,
            effective_stack_chips: i32,
            flops: Vec<String>,
        }
        let raw: Raw = serde_json::from_str(text).map_err(|e| format!("failed to parse scenario JSON: {e}"))?;
        Ok(Scenario {
            scenario_id: raw.scenario_id,
            label: raw.label,
            oop_position: raw.oop_position,
            ip_position: raw.ip_position,
            oop_range_str: raw.oop_range_str,
            ip_range_str: raw.ip_range_str,
            starting_pot_chips: raw.starting_pot_chips,
            effective_stack_chips: raw.effective_stack_chips,
            flops: raw.flops,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_generated_scenario_json() {
        // tools/gen-solver-scenarios.mjs が実際に出力したファイルの1つを対象に、
        // 全17シナリオがパースできることを確認する(スキーマの齟齬を検出する)。
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios");
        let entries = std::fs::read_dir(&dir).expect("scenarios dir should exist (run tools/gen-solver-scenarios.mjs first)");
        let mut count = 0;
        for entry in entries {
            let entry = entry.unwrap();
            if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let scenario = Scenario::load(&entry.path()).expect("scenario should parse");
            assert!(!scenario.scenario_id.is_empty());
            assert!(scenario.starting_pot_chips > 0);
            assert!(scenario.effective_stack_chips > scenario.starting_pot_chips);
            assert_eq!(scenario.flops.len(), 95);
            assert!(!scenario.oop_range_str.is_empty());
            assert!(!scenario.ip_range_str.is_empty());
            count += 1;
        }
        assert_eq!(count, 17, "expected 17 scenario JSON files");
    }
}
