import { describe, expect, it } from 'vitest'
import type { FlopDef } from '../types'
import existingFlopsJson from './flops.json'
import allFlopsJson from './flopsAll.json'

const TOTAL_COMBINATIONS = 22_100
const WEIGHT_TOLERANCE = 1e-12
const RANK_CHARS = new Set(['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'])
const SUIT_CHARS = new Set(['c', 'd', 'h', 's'])
const flops = allFlopsJson as FlopDef[]
const existingFlops = existingFlopsJson as FlopDef[]

function comboCount(selected: readonly FlopDef[]): number {
  // weightは必ず整数クラスサイズ/22,100。各項を整数へ戻してから既知値と完全一致させる。
  return selected.reduce((total, flop) => total + Math.round(flop.weight * TOTAL_COMBINATIONS), 0)
}

describe('全1,755スート同型フロップ', () => {
  it('1,755件を定義し、weightの合計が許容誤差内で1になる', () => {
    expect(flops).toHaveLength(1_755)
    const totalWeight = flops.reduce((total, flop) => total + flop.weight, 0)
    expect(Math.abs(totalWeight - 1)).toBeLessThanOrEqual(WEIGHT_TOLERANCE)
  })

  it('クラスサイズ分布が全22,100コンボと一致する', () => {
    const distribution = new Map<number, number>()
    for (const flop of flops) {
      const size = Math.round(flop.weight * TOTAL_COMBINATIONS)
      distribution.set(size, (distribution.get(size) ?? 0) + 1)
    }

    expect(Object.fromEntries(distribution)).toEqual({ 4: 299, 12: 1_170, 24: 286 })
    expect(comboCount(flops)).toBe(TOTAL_COMBINATIONS)
  })

  it('既知のスートテクスチャ別コンボ数と完全一致する', () => {
    const monotone = flops.filter((flop) => flop.texture.monotone)
    const twoTone = flops.filter((flop) => flop.texture.twoTone)
    const rainbow = flops.filter((flop) => !flop.texture.monotone && !flop.texture.twoTone)

    expect(comboCount(monotone)).toBe(1_144)
    expect(comboCount(rainbow)).toBe(8_788)
    expect(comboCount(twoTone)).toBe(12_168)
  })

  it('ペアを含む既知コンボ数と完全一致する', () => {
    expect(comboCount(flops.filter((flop) => flop.texture.paired))).toBe(3_796)
  })

  it('全要素がFlopDefとして妥当で、テクスチャ値もカードと一致する', () => {
    const flopKeys = new Set<string>()
    for (const flop of flops) {
      expect(flop.cards).toHaveLength(3)
      expect(new Set(flop.cards).size).toBe(3)
      expect(flop.weight).toBeGreaterThan(0)
      expect(typeof flop.texture.paired).toBe('boolean')
      expect(typeof flop.texture.monotone).toBe('boolean')
      expect(typeof flop.texture.twoTone).toBe('boolean')

      for (const card of flop.cards) {
        expect(card).toHaveLength(2)
        expect(RANK_CHARS.has(card[0]), card).toBe(true)
        expect(SUIT_CHARS.has(card[1]), card).toBe(true)
      }

      const ranks = flop.cards.map((card) => card[0])
      const suitCount = new Set(flop.cards.map((card) => card[1])).size
      expect(flop.texture.paired).toBe(new Set(ranks).size < 3)
      expect(flop.texture.monotone).toBe(suitCount === 1)
      expect(flop.texture.twoTone).toBe(suitCount === 2)
      expect(flop.texture.highCardCount).toBe(ranks.filter((rank) => 'AKQJT'.includes(rank)).length)

      const key = [...flop.cards].sort().join(',')
      expect(flopKeys.has(key), `重複フロップ: ${key}`).toBe(false)
      flopKeys.add(key)
    }
  })

  it('既存95フロップのcardsをすべて完全に含む', () => {
    const allCardKeys = new Set(flops.map((flop) => flop.cards.join(',')))
    for (const existing of existingFlops) {
      expect(allCardKeys.has(existing.cards.join(',')), existing.cards.join(',')).toBe(true)
    }
  })
})
