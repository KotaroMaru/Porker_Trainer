// P4 Step 1: FreqRangeを実際のコンボ(重み付き)に展開する。
// crossvalidationテスト(P3 Step5)のexpandWeightedRangeをここに昇格して共通化する。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { expandHandStr } from '../../analysis/range'
import { cardKey } from '../../engine/deck'
import { getRange } from '../data/ranges'

export interface WeightedCombos {
  combos: Combo[]
  weights: number[]
}

/**
 * レンジID(preflopRanges.json)を、指定ボードと衝突しないコンボとその頻度の
 * 対応に展開する。フロップ+ターンの4枚が既に見えている場合はそれをboardに渡す。
 */
export function expandWeightedRange(rangeId: string, board: Card[]): WeightedCombos {
  const range = getRange(rangeId)
  const deadSet = new Set(board.map(cardKey))
  const combos: Combo[] = []
  const weights: number[] = []
  for (const [handStr, freq] of Object.entries(range)) {
    if (freq <= 0) continue
    for (const combo of expandHandStr(handStr)) {
      if (deadSet.has(cardKey(combo[0])) || deadSet.has(cardKey(combo[1]))) continue
      combos.push(combo)
      weights.push(freq)
    }
  }
  return { combos, weights }
}
