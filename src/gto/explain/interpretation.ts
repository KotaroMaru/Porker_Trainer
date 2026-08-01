// P14 L1: SpotFeaturesの事実を、全ての表示先が共有する解釈へ一度だけ変換する。
// ソルバーの「意図」は推測せず、観測できる頻度・エクイティ・カード構造だけを記述する。

import type { HandStrength } from '../../advisor/postflop'
import type { ReviewDecision } from '../trainer/reviewBuilder'
import type { SdvLevel, SpotFeatures, WeakPairSubtype } from './features'

export function rangeAdvantageLabelJa(value: SpotFeatures['rangeAdvantage']): string {
  if (value.heroAvg > value.villainAvg + 0.03) return 'レンジ優位'
  if (value.villainAvg > value.heroAvg + 0.03) return 'レンジ劣位'
  return '互角'
}

export function nutsAdvantageLabelJa(value: SpotFeatures['nutsAdvantage']): string {
  if (value.heroTopPct > value.villainTopPct + 3) return 'ナッツ優位'
  if (value.villainTopPct > value.heroTopPct + 3) return 'ナッツ劣位'
  return '互角'
}

export function sprLabelJa(value: SpotFeatures['sprBucket']): string {
  if (value.bucket === 'low') return '低SPR(<3)'
  if (value.bucket === 'middle') return '中SPR(3-6)'
  return '高SPR(>6)'
}

export type BetProfileKind = 'value' | 'protection' | 'semiBluff' | 'pureBluff'
export type ValueThickness = 'thin' | 'thick'
export type DeviationDriver = 'blocker' | 'backdoor' | 'thinSdv'

export interface HandDescriptor {
  classJa: string
  baselineClassJa: string
  sdvLevel: SdvLevel
  weakPairSubtype: WeakPairSubtype | null
  drawsJa: string[]
  backdoorsJa: string[]
}

export interface BetProfile {
  forLabel: string
  kind: BetProfileKind
  valueThickness: ValueThickness | null
  continueEquity: number | null
  foldFreq: number | null
  targetsToShow: 'continueWeak' | 'folded' | 'both'
}

export interface SpotInterpretation {
  handDescriptor: HandDescriptor
  betProfile: BetProfile | null
  classBaseline: { mixJa: string; rangeContextJa: string | null }
  deviation: { level: 'typical' | 'outlier'; deltaPp: number; drivers: DeviationDriver[] }
}

export const DEVIATION_OUTLIER_THRESHOLD_PP = 20

export const BET_PROFILE_LABEL_JA: Record<BetProfileKind, string> = {
  value: 'バリューベット',
  protection: 'エクイティ保護ベット',
  semiBluff: 'セミブラフ',
  pureBluff: 'フォールド利益型ベット',
}

const BASELINE_CLASS_JA: Record<HandStrength, string> = {
  MONSTER: 'モンスター(フルハウス以上)',
  STRONG_MADE: '強い完成手(フラッシュ/ストレート/トリップス/ツーペア)',
  MIDDLE: 'ミドル(トップペア以上のワンペア)',
  WEAK_PAIR: '弱いペア',
  STRONG_DRAW: '強いドロー(フラッシュ/オープンエンド)',
  WEAK_DRAW: '弱いドロー(ガットショット)',
  AIR: 'ノーペア',
}

const SDV_LABEL_JA: Record<SdvLevel, string> = {
  solid: 'SDVありのハイカード',
  thin: 'SDVが薄いハイカード',
  none: 'SDVなしのハイカード',
}

const WEAK_PAIR_LABEL_JA: Record<WeakPairSubtype, string> = {
  bluffCatcher: '弱いペア(ブラフキャッチャー型)',
  drawPaired: '弱いペア(ドロー付き)',
}

function handClassJa(features: SpotFeatures): string {
  if (features.handClass === 'AIR') return SDV_LABEL_JA[features.sdvLevel]
  if (features.handClass === 'WEAK_PAIR' && features.weakPairSubtype) return WEAK_PAIR_LABEL_JA[features.weakPairSubtype]
  return BASELINE_CLASS_JA[features.handClass]
}

function describeHand(features: SpotFeatures): HandDescriptor {
  const drawsJa: string[] = []
  if (features.draws.hasFlushDraw) drawsJa.push('フラッシュドロー')
  if (features.draws.hasOESD) drawsJa.push('オープンエンドストレートドロー')
  else if (features.draws.hasGutshot) drawsJa.push('ガットショット')

  const backdoorsJa: string[] = []
  if (features.backdoors.flush.has) backdoorsJa.push(features.backdoors.flush.isNut ? 'ナッツ・バックドアフラッシュ' : 'バックドアフラッシュ')
  if (features.backdoors.straight.has) backdoorsJa.push(features.backdoors.straight.isWheel ? 'ホイール・バックドアストレート' : 'バックドアストレート')

  return {
    classJa: handClassJa(features),
    baselineClassJa: BASELINE_CLASS_JA[features.handClass],
    sdvLevel: features.sdvLevel,
    weakPairSubtype: features.weakPairSubtype,
    drawsJa,
    backdoorsJa,
  }
}

function isBetLabel(label: string): boolean {
  return label !== 'check' && label !== 'call' && label !== 'fold'
}

/** S2移行中の複数アクション表示にも同じ判定順を使えるよう、ラベル単位で公開する。 */
export function interpretBetProfile(label: string, features: SpotFeatures): BetProfile | null {
  if (!isBetLabel(label)) return null
  const response = features.responses.find((candidate) => candidate.forLabel === label)
  const continueEquity = response?.heroEquityVsContinueRange ?? null
  const foldFreq = response && !response.terminal ? response.foldFreq : null

  if (continueEquity !== null && continueEquity >= 0.5) {
    return {
      forLabel: label,
      kind: 'value',
      valueThickness: continueEquity >= 0.6 ? 'thick' : 'thin',
      continueEquity,
      foldFreq,
      targetsToShow: 'continueWeak',
    }
  }
  if (features.sdvLevel !== 'none') {
    return { forLabel: label, kind: 'protection', valueThickness: null, continueEquity, foldFreq, targetsToShow: 'folded' }
  }
  const hasDraw = features.draws.hasFlushDraw || features.draws.hasOESD || features.draws.hasGutshot
  const hasBackdoor = features.backdoors.flush.has || features.backdoors.straight.has
  if (hasDraw || hasBackdoor) {
    return { forLabel: label, kind: 'semiBluff', valueThickness: null, continueEquity, foldFreq, targetsToShow: 'folded' }
  }
  return { forLabel: label, kind: 'pureBluff', valueThickness: null, continueEquity, foldFreq, targetsToShow: 'folded' }
}

function buildClassBaseline(features: SpotFeatures): SpotInterpretation['classBaseline'] {
  const top = features.sameClass.actionMix.reduce<{ label: string; freq: number } | null>((best, entry) => (!best || entry.freq > best.freq ? entry : best), null)
  const mixJa = top ? `${top.label} ${Math.round(top.freq * 100)}%` : 'データ不足'
  const hasRangeAdvantage = features.rangeAdvantage.heroAvg > features.rangeAdvantage.villainAvg + 0.03
  const hasNutsAdvantage = features.nutsAdvantage.heroTopPct > features.nutsAdvantage.villainTopPct + 3
  const dry = !features.boardTexture.connected && features.boardTexture.suitPattern !== 'monotone'
  const rangeContextJa =
    hasRangeAdvantage && hasNutsAdvantage && features.streetStructure.villainCheckedToHero === true && dry
      ? 'レンジ優位とナッツ優位があり、相手のチェック後のドライなボードです'
      : null
  return { mixJa, rangeContextJa }
}

function buildDeviation(features: SpotFeatures, betProfile: BetProfile | null): SpotInterpretation['deviation'] {
  const deltaPp = features.comboVsClass.deltaPp
  const level = Math.abs(deltaPp) >= DEVIATION_OUTLIER_THRESHOLD_PP ? 'outlier' : 'typical'
  const drivers: DeviationDriver[] = []
  if (level === 'outlier') {
    if (Math.max(features.blockers.valueCombosReducedPct, features.blockers.bluffCombosReducedPct) >= 3) drivers.push('blocker')
    if (features.backdoors.flush.has || features.backdoors.straight.has) drivers.push('backdoor')
    if (features.sdvLevel !== 'none' && (betProfile?.continueEquity ?? 1) < 0.5) drivers.push('thinSdv')
  }
  return { level, deltaPp, drivers }
}

export function interpretSpot(decision: ReviewDecision, features: SpotFeatures): SpotInterpretation {
  const betProfile = interpretBetProfile(decision.grading.bestLabel, features)
  return {
    handDescriptor: describeHand(features),
    betProfile,
    classBaseline: buildClassBaseline(features),
    deviation: buildDeviation(features, betProfile),
  }
}
