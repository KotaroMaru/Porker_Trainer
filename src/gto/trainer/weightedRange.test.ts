import { describe, it, expect } from 'vitest'
import { expandWeightedRange } from './weightedRange'
import { getRange } from '../data/ranges'
import { weightedComboCount } from '../data/ranges'
import type { Card } from '../../engine/types'

describe('expandWeightedRange', () => {
  it('ボードと衝突しないコンボのみ返し、重みの合計はweightedComboCountと(ボード衝突分を除いて)一致する', () => {
    const board: Card[] = []
    const { combos, weights } = expandWeightedRange('rfi_btn', board)
    expect(combos.length).toBe(weights.length)
    expect(combos.length).toBeGreaterThan(0)

    const totalWeight = weights.reduce((a, b) => a + b, 0)
    expect(totalWeight).toBeCloseTo(weightedComboCount(getRange('rfi_btn')), 6)
  })

  it('ボードと衝突するコンボは除外される', () => {
    const board: Card[] = [{ rank: 14, suit: 's' }] // As
    const { combos } = expandWeightedRange('rfi_btn', board)
    for (const combo of combos) {
      for (const card of combo) {
        expect(card.rank === 14 && card.suit === 's').toBe(false)
      }
    }
  })

  it('各コンボの重みは元のFreqRangeの値と一致する(頻度の伝播が正しい)', () => {
    const board: Card[] = []
    const range = getRange('bb_call_vs_btn')
    const { combos, weights } = expandWeightedRange('bb_call_vs_btn', board)
    // 適当な1件をサンプルし、頻度が freq<1 のハンドのweightと一致することを確認
    const fractionalHand = Object.entries(range).find(([, freq]) => freq > 0 && freq < 1)
    if (fractionalHand) {
      const [, expectedFreq] = fractionalHand
      const idx = combos.findIndex((_, i) => Math.abs(weights[i] - expectedFreq) < 1e-9)
      expect(idx).toBeGreaterThanOrEqual(0)
    }
  })
})
