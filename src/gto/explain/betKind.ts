// P14 S2移行アダプター。分類の正典はinterpretation.tsだけに置き、P13 APIの消費者は
// S3/S4でClaim/props駆動へ移すまでこの薄い変換を使う。

import type { SpotFeatures } from './features'
import { interpretBetProfile, type BetProfileKind, type ValueThickness } from './interpretation'

export type BetKind = BetProfileKind
export type { ValueThickness }

export interface BetKindResult {
  kind: BetKind
  valueThickness: ValueThickness | null
  reasonJa: string
}

export function classifyBetKind(label: string, features: SpotFeatures): BetKindResult | null {
  const profile = interpretBetProfile(label, features)
  if (!profile) return null
  const continueEqJa = profile.continueEquity === null ? '未計算' : `${(profile.continueEquity * 100).toFixed(0)}%`
  const foldFreqJa = profile.foldFreq === null ? '未計算' : `${(profile.foldFreq * 100).toFixed(0)}%`

  if (profile.kind === 'value') {
    return { kind: profile.kind, valueThickness: profile.valueThickness, reasonJa: `相手の継続レンジに対するエクイティは${continueEqJa}です。` }
  }
  if (profile.kind === 'protection') {
    return { kind: profile.kind, valueThickness: null, reasonJa: `現時点のショーダウン価値を持ち、相手の観測フォールド率は${foldFreqJa}です。` }
  }
  if (profile.kind === 'semiBluff') {
    return { kind: profile.kind, valueThickness: null, reasonJa: `現時点のショーダウン価値は低い一方、通常またはバックドアのドローがあります。相手の観測フォールド率は${foldFreqJa}です。` }
  }
  return { kind: profile.kind, valueThickness: null, reasonJa: `現時点のショーダウン価値とドローが乏しく、相手の観測フォールド率は${foldFreqJa}です。` }
}
