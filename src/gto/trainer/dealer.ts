// P4 Step 1: シナリオ+フロップから、両者のハンドをレンジ頻度重みでサンプルする。
// カード衝突(ボードとの衝突・両者の手札同士の衝突)を避ける。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { expandWeightedRange } from './weightedRange'

export interface DealtHands {
  oopCombo: Combo
  ipCombo: Combo
}

/** 重み付きコンボ配列から1つをサンプルする(rng()は[0,1)を返す関数)。 */
export function weightedSampleCombo(combos: Combo[], weights: number[], rng: () => number): Combo {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('weightedSampleCombo: empty or zero-weight range')
  let r = rng() * total
  for (let i = 0; i < combos.length; i++) {
    r -= weights[i]
    if (r <= 0) return combos[i]
  }
  return combos[combos.length - 1]
}

/**
 * OOP/IP両者のハンドをそれぞれのレンジからサンプルする。OOPを先にサンプルし、
 * IPはボード+OOPの手札を除外した上で再度重み展開してからサンプルする
 * (両者の手札が重複しないようにするため)。
 */
export function dealHands(oopRangeId: string, ipRangeId: string, board: Card[], rng: () => number): DealtHands {
  const oopRange = expandWeightedRange(oopRangeId, board)
  const oopCombo = weightedSampleCombo(oopRange.combos, oopRange.weights, rng)

  const ipRange = expandWeightedRange(ipRangeId, [...board, ...oopCombo])
  if (ipRange.combos.length === 0) {
    throw new Error(`dealHands: IP range ${ipRangeId} has no combos left after excluding board+OOP hand`)
  }
  const ipCombo = weightedSampleCombo(ipRange.combos, ipRange.weights, rng)

  return { oopCombo, ipCombo }
}
