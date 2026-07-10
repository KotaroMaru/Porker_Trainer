// P4 Step 1: EVロス採点。確定仕様5(承認済みプラン): GTO頻度 ≥ max(絶対閾値, 相対閾値×最頻度)
// なら正解。不正解時は最善手とのEV差(bb)を返す。

import type { DecodedNode } from '../loader/binaryFormat'

/** 正解判定の絶対閾値(この頻度未満は、最頻度が何であれ不正解)。 */
export const CORRECT_FREQ_ABS_THRESHOLD = 0.15
/** 正解判定の相対閾値(最頻度に対する比率)。 */
export const CORRECT_FREQ_REL_THRESHOLD = 0.25

export interface ActionBreakdownEntry {
  label: string
  freq: number
  evBb: number
}

export interface GradeResult {
  correct: boolean
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
  const correct = chosenFreq >= threshold

  const best = actionBreakdown.reduce((a, b) => (b.evBb > a.evBb ? b : a))
  const chosenEvBb = actionBreakdown[chosenIdx].evBb

  return {
    correct,
    evLossBb: best.evBb - chosenEvBb,
    bestLabel: best.label,
    bestEvBb: best.evBb,
    chosenEvBb,
    actionBreakdown,
  }
}
