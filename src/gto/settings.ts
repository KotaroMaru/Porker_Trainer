// P6 Step B7: 通しモード/シナリオ選択の永続化設定。
// src/store/persistence.tsと同じtry-catchパターン(localStorage不可時は無視・既定値へ
// フォールバック)。enabledScenarioIdsの実際の絞り込み適用(startNewSpotでの利用)はB9。

import { SCENARIOS } from './data/scenarios'

const SETTINGS_KEY = 'poker_trainer_gto_settings'

export type GtoMode = 'single' | 'full'

export interface GtoSettings {
  mode: GtoMode
  enabledScenarioIds: string[]
}

/** 既定値: 単発モード・全シナリオ有効。 */
export function defaultGtoSettings(): GtoSettings {
  return { mode: 'single', enabledScenarioIds: SCENARIOS.map((s) => s.id) }
}

export function saveGtoSettings(settings: GtoSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // localStorage not available (e.g. in tests)
  }
}

export function loadGtoSettings(): GtoSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultGtoSettings()
    const parsed = JSON.parse(raw)
    if (parsed.mode !== 'single' && parsed.mode !== 'full') return defaultGtoSettings()
    if (!Array.isArray(parsed.enabledScenarioIds) || !parsed.enabledScenarioIds.every((id: unknown) => typeof id === 'string')) {
      return defaultGtoSettings()
    }
    return { mode: parsed.mode, enabledScenarioIds: parsed.enabledScenarioIds }
  } catch {
    return defaultGtoSettings()
  }
}
