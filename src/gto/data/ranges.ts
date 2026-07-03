import type { FreqRange } from '../types'
import preflopRangesJson from './preflopRanges.json'

const RANGES = preflopRangesJson as Record<string, FreqRange>

/** レンジID(例: "rfi_utg", "bb_call_vs_btn")から頻度付きレンジを取得する。 */
export function getRange(rangeId: string): FreqRange {
  const range = RANGES[rangeId]
  if (!range) throw new Error(`Unknown GTO range id: ${rangeId}`)
  return range
}

export function listRangeIds(): string[] {
  return Object.keys(RANGES)
}

function comboCount(handStr: string): number {
  if (handStr.length === 2) return 6
  return handStr.endsWith('s') ? 4 : 12
}

/** レンジ全体の加重コンボ数(頻度考慮)。テストや統計表示に使う。 */
export function weightedComboCount(range: FreqRange): number {
  let total = 0
  for (const [hand, freq] of Object.entries(range)) {
    total += comboCount(hand) * freq
  }
  return total
}

const TOTAL_COMBOS = 1326

/** レンジが占める割合(0..1)。VPIP相当の統計表示・テストに使う。 */
export function rangePercent(range: FreqRange): number {
  return weightedComboCount(range) / TOTAL_COMBOS
}
