// P4 Step 1: EVロス採点。確定仕様5(承認済みプラン): GTO頻度 ≥ max(絶対閾値, 相対閾値×最頻度)
// なら正解。不正解時は最善手とのEV差(bb)を返す。
//
// 許容バンド(2026-07-06承認・仕様改訂): 採点は2値(正解/不正解)ではなく3値
// (correct/marginal/incorrect)。同一部分ゲームを収束レベルを変えてデコードし
// 採点判定の一致率を比較したところ、収束をどれだけ締めても判定が約3%動き続ける
// ことが判明した——真のGTO頻度が閾値ちょうどの境界に自然に張り付いている手が
// 一定数存在するためで、これはソルバーの収束不足ではなく、ハード閾値と混合戦略の
// 相互作用そのもの(収束を上げても解消しない)。そのため閾値±GRADING_TOLERANCE_BAND
// の範囲は「境界上の手」としてmarginal(不正解にしない)とし、収束ノイズと本質的
// 無差別の両方に頑健にする(詳細: modular-bubbling-toucan.mdの
// 「収束品質の検証と方針決定」セクション)。

import type { DecodedNode } from '../loader/binaryFormat'

/** 正解判定の絶対閾値(この頻度未満は、最頻度が何であれ不正解)。 */
export const CORRECT_FREQ_ABS_THRESHOLD = 0.15
/** 正解判定の相対閾値(最頻度に対する比率)。 */
export const CORRECT_FREQ_REL_THRESHOLD = 0.25
/** 許容バンド幅。閾値±この値は境界上の手としてmarginal扱いにする。 */
export const GRADING_TOLERANCE_BAND = 0.05

export type GradeVerdict = 'correct' | 'marginal' | 'incorrect'

export interface ActionBreakdownEntry {
  label: string
  freq: number
  evBb: number
}

export interface GradeResult {
  verdict: GradeVerdict
  /** 最善手のEV - 選んだ手のEV(bb)。正解でも僅かな混合戦略内誤差でわずかに正になりうる。 */
  evLossBb: number
  bestLabel: string
  bestEvBb: number
  chosenEvBb: number
  /** 全アクションのfreq/EV(表示用)。 */
  actionBreakdown: ActionBreakdownEntry[]
}

/** ノードの戦略/EVと、指定コンボ・選択アクションから採点結果を作る。 */
export function gradeDecision(node: DecodedNode, comboIdx: number, chosenLabel: string): GradeResult {
  const handCount = node.freqs.length / node.actionLabels.length
  const chosenIdx = node.actionLabels.indexOf(chosenLabel)
  if (chosenIdx < 0) {
    throw new Error(`gradeDecision: unknown action label "${chosenLabel}" (expected one of ${node.actionLabels.join(',')})`)
  }

  const actionBreakdown: ActionBreakdownEntry[] = node.actionLabels.map((label, a) => ({
    label,
    freq: node.freqs[a * handCount + comboIdx],
    evBb: node.evsBb[a * handCount + comboIdx],
  }))

  const maxFreq = Math.max(...actionBreakdown.map((a) => a.freq))
  const chosenFreq = actionBreakdown[chosenIdx].freq
  const threshold = Math.max(CORRECT_FREQ_ABS_THRESHOLD, CORRECT_FREQ_REL_THRESHOLD * maxFreq)
  const verdict: GradeVerdict =
    chosenFreq >= threshold + GRADING_TOLERANCE_BAND
      ? 'correct'
      : chosenFreq >= threshold - GRADING_TOLERANCE_BAND
        ? 'marginal'
        : 'incorrect'

  const best = actionBreakdown.reduce((a, b) => (b.evBb > a.evBb ? b : a))
  const chosenEvBb = actionBreakdown[chosenIdx].evBb

  return {
    verdict,
    evLossBb: best.evBb - chosenEvBb,
    bestLabel: best.label,
    bestEvBb: best.evBb,
    chosenEvBb,
    actionBreakdown,
  }
}
