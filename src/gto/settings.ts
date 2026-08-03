// P6 Step B7: 通しモード/シナリオ選択の永続化設定。
// src/store/persistence.tsと同じtry-catchパターン(localStorage不可時は無視・既定値へ
// フォールバック)。enabledScenarioIdsの実際の絞り込み適用(startNewSpotでの利用)はB9。

import { SCENARIOS } from './data/scenarios'

const SETTINGS_KEY = 'poker_trainer_gto_settings'

export type GtoMode = 'single' | 'full'

export interface GtoSettings {
  mode: GtoMode
  enabledScenarioIds: string[]
  /**
   * P15: 特化モードで固定中のシナリオID。nullなら通常モード。
   *
   * 非nullのとき出題はこのシナリオのみに絞られ、enabledScenarioIdsより優先される。
   * enabledScenarioIds自体は書き換えないので、特化モードを解除すれば元の選択へ戻る。
   */
  focusScenarioId: string | null
}

/** 既定値: 単発モード・全シナリオ有効・特化モードなし。 */
export function defaultGtoSettings(): GtoSettings {
  return { mode: 'single', enabledScenarioIds: SCENARIOS.map((s) => s.id), focusScenarioId: null }
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
    // focusScenarioIdはP15で追加した後発フィールド。既存の保存値には存在しないため、
    // 「形が違う=全体を既定値へ戻す」の対象にしない(ユーザーのenabledScenarioIdsを失う)。
    const focusScenarioId = typeof parsed.focusScenarioId === 'string' ? parsed.focusScenarioId : null
    return { mode: parsed.mode, enabledScenarioIds: parsed.enabledScenarioIds, focusScenarioId }
  } catch {
    return defaultGtoSettings()
  }
}

/**
 * 出題対象のシナリオIDを返す。特化モード中はそのシナリオのみ。
 *
 * 呼び出し側が「focusScenarioIdがあればそちら、無ければenabledScenarioIds」を
 * 各所で書くと優先順位の解釈がずれるため、ここに一元化する。
 */
export function activeScenarioIds(settings: GtoSettings): string[] {
  return settings.focusScenarioId ? [settings.focusScenarioId] : settings.enabledScenarioIds
}
