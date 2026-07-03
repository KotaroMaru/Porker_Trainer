import { describe, it, expect } from 'vitest'
import { FLOPS, pickWeightedFlop } from './flops'

const RANK_CHARS = new Set(['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'])
const SUIT_CHARS = new Set(['c', 'd', 'h', 's'])

describe('代表フロップ95種', () => {
  it('95件のフロップが定義されている', () => {
    expect(FLOPS.length).toBe(95)
  })

  it('重みの合計はほぼ1', () => {
    const total = FLOPS.reduce((s, f) => s + f.weight, 0)
    expect(total).toBeGreaterThan(0.99)
    expect(total).toBeLessThan(1.01)
  })

  it('各フロップのカードは正しい表記(ランク+スート)で重複しない', () => {
    for (const f of FLOPS) {
      expect(f.cards.length).toBe(3)
      const seen = new Set<string>()
      for (const card of f.cards) {
        expect(RANK_CHARS.has(card[0]), card).toBe(true)
        expect(SUIT_CHARS.has(card[1]), card).toBe(true)
        expect(seen.has(card), `duplicate card ${card} in ${f.cards}`).toBe(false)
        seen.add(card)
      }
    }
  })

  it('フロップの組み合わせ自体に重複がない', () => {
    const keys = FLOPS.map((f) => [...f.cards].sort().join(','))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('カテゴリ別重みの合計は実際の出現確率に近い(モノトーン<ペア<レインボー<ツートーン)', () => {
    function isTrips(f: (typeof FLOPS)[number]) {
      return f.texture.paired && new Set(f.cards.map((c) => c[0])).size === 1
    }
    const monotone = FLOPS.filter((f) => f.texture.monotone).reduce((s, f) => s + f.weight, 0)
    const twoTone = FLOPS.filter((f) => f.texture.twoTone).reduce((s, f) => s + f.weight, 0)
    const rainbow = FLOPS.filter((f) => !f.texture.monotone && !f.texture.twoTone && !f.texture.paired).reduce((s, f) => s + f.weight, 0)
    const paired = FLOPS.filter((f) => f.texture.paired && !isTrips(f)).reduce((s, f) => s + f.weight, 0)
    expect(monotone).toBeGreaterThan(0.02)
    expect(monotone).toBeLessThan(0.09)
    expect(paired).toBeGreaterThan(0.1)
    expect(paired).toBeLessThan(0.24)
    expect(rainbow).toBeGreaterThan(0.24)
    expect(rainbow).toBeLessThan(0.38)
    expect(twoTone).toBeGreaterThan(0.4)
    expect(twoTone).toBeLessThan(0.53)
  })

  it('pickWeightedFlopは常にFLOPS内のフロップを返す', () => {
    for (let i = 0; i < 100; i++) {
      expect(FLOPS).toContain(pickWeightedFlop())
    }
  })
})
