// P13 Phase C-1: ベット系アクション(bet33/bet75/raise55/allin)を、既存featuresの数値だけから
// 「バリュー/セミブラフ/ピュアブラフ/プロテクション」に分類する。新規のエクイティ計算はせず、
// features.responses(chosen/bestの2アクションのみ計算済み)のheroEquityVsContinueRange/foldFreq、
// およびhandClass/drawsだけを使う。check/call/foldではnullを返す。

import type { SpotFeatures } from './features'

export type BetKind = 'value' | 'semiBluff' | 'pureBluff' | 'protection'
export type ValueThickness = 'thin' | 'thick'

export interface BetKindResult {
  kind: BetKind
  valueThickness: ValueThickness | null
  reasonJa: string
}

const VALUE_EQUITY_THIN_THRESHOLD = 0.5
const VALUE_EQUITY_THICK_THRESHOLD = 0.6
const PROTECTION_FOLD_FREQ_HIGH_THRESHOLD = 0.5

function isBetLabel(label: string): boolean {
  return label !== 'check' && label !== 'call' && label !== 'fold'
}

// MIDDLE/WEAK_PAIRは「弱いなりのショーダウン価値」を既に持つため、AIR/ドロー系とは別に
// protection分岐で扱う(B-2いのWEAK_PAIR細分化とは独立の軸)。
const LOW_SDV_HAND_CLASSES: ReadonlySet<SpotFeatures['handClass']> = new Set(['AIR', 'STRONG_DRAW', 'WEAK_DRAW'])

export function classifyBetKind(label: string, features: SpotFeatures): BetKindResult | null {
  if (!isBetLabel(label)) return null

  const response = features.responses.find((r) => r.forLabel === label)
  const continueEq = response?.heroEquityVsContinueRange ?? null
  const foldFreq = response && !response.terminal ? response.foldFreq : null

  if (continueEq !== null && continueEq >= VALUE_EQUITY_THIN_THRESHOLD) {
    const valueThickness: ValueThickness = continueEq >= VALUE_EQUITY_THICK_THRESHOLD ? 'thick' : 'thin'
    return {
      kind: 'value',
      valueThickness,
      reasonJa: `相手の継続レンジに対しても${(continueEq * 100).toFixed(0)}%のエクイティがあり、コールを集めて価値を伸ばせます。`,
    }
  }

  if (LOW_SDV_HAND_CLASSES.has(features.handClass)) {
    const hasDraw = features.draws.hasFlushDraw || features.draws.hasOESD || features.draws.hasGutshot
    if (hasDraw) {
      return {
        kind: 'semiBluff',
        valueThickness: null,
        reasonJa: '現状のショーダウン価値は低いものの、完成すれば強くなるドローを持っているため、フォールドを取れなくても損をしにくいセミブラフです。',
      }
    }
    return {
      kind: 'pureBluff',
      valueThickness: null,
      reasonJa: 'ショーダウン価値がほとんど無く、相手のフォールドを取ることを主目的にしたピュアブラフです。',
    }
  }

  if (features.handClass === 'MIDDLE' || features.handClass === 'WEAK_PAIR') {
    const foldFreqNotHigh = foldFreq === null || foldFreq < PROTECTION_FOLD_FREQ_HIGH_THRESHOLD
    if (foldFreqNotHigh) {
      const foldFreqJa = foldFreq !== null ? `${(foldFreq * 100).toFixed(0)}%` : '不明'
      return {
        kind: 'protection',
        valueThickness: null,
        reasonJa: `相手のフォールド率は${foldFreqJa}とそれほど高くなく、ポットを大きくしすぎずにエクイティを守るプロテクションベットです。`,
      }
    }
  }

  // MONSTER/STRONG_MADEでcontinueEqがしきい値未満・null(応答ノード無し等)の残余ケースと、
  // フォールド率が高いMIDDLE/WEAK_PAIR。必ず何かを返す必要があるため、保守的にvalueへ倒す。
  return {
    kind: 'value',
    valueThickness: 'thin',
    reasonJa: 'ある程度の強さがある手で、サイズは小さくても価値を積み重ねるバリューベットです。',
  }
}
