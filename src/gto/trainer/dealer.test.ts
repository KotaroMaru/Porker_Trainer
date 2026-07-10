import { describe, it, expect } from 'vitest'
import { dealHands, weightedSampleCombo } from './dealer'
import { expandWeightedRange } from './weightedRange'
import { cardKey } from '../../engine/deck'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function fixedRng(value: number): () => number {
  return () => value
}

describe('weightedSampleCombo', () => {
  it('rng()=0は常に先頭のコンボを返す', () => {
    const combos: Combo[] = [
      [{ rank: 14, suit: 's' }, { rank: 14, suit: 'h' }],
      [{ rank: 13, suit: 's' }, { rank: 13, suit: 'h' }],
    ]
    const weights = [0.5, 0.5]
    const picked = weightedSampleCombo(combos, weights, fixedRng(0))
    expect(picked).toBe(combos[0])
  })

  it('rng()が1に近いと最後のコンボを返す', () => {
    const combos: Combo[] = [
      [{ rank: 14, suit: 's' }, { rank: 14, suit: 'h' }],
      [{ rank: 13, suit: 's' }, { rank: 13, suit: 'h' }],
    ]
    const weights = [0.5, 0.5]
    const picked = weightedSampleCombo(combos, weights, fixedRng(0.9999))
    expect(picked).toBe(combos[1])
  })
})

describe('dealHands', () => {
  const board: Card[] = [
    { rank: 12, suit: 'h' }, // Qh
    { rank: 8, suit: 'd' }, // 8d
    { rank: 3, suit: 'c' }, // 3c
  ]

  it('OOP/IPの手札がボード・互いのカードと衝突しない(多数回サンプルして確認)', () => {
    let seed = 1
    const rng = () => {
      // 決定的だが分布のある簡易疑似乱数(xorshift風)
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 200; i++) {
      const { oopCombo, ipCombo } = dealHands('bb_call_vs_btn', 'rfi_btn', board, rng)
      const allKeys = [...board.map(cardKey), ...oopCombo.map(cardKey), ...ipCombo.map(cardKey)]
      const uniqueKeys = new Set(allKeys)
      expect(uniqueKeys.size, `iteration ${i}`).toBe(allKeys.length)
    }
  })

  it('サンプルされたコンボは元のレンジ展開に含まれる', () => {
    const rng = fixedRng(0.3)
    const { oopCombo } = dealHands('bb_call_vs_btn', 'rfi_btn', board, rng)
    const { combos } = expandWeightedRange('bb_call_vs_btn', board)
    const found = combos.some((c) => cardKey(c[0]) === cardKey(oopCombo[0]) && cardKey(c[1]) === cardKey(oopCombo[1]))
    expect(found).toBe(true)
  })
})
