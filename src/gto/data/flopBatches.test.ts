import { describe, expect, it } from 'vitest'
import type { FlopDef } from '../types'
import { createStratifiedFlopBatches, flopTextureStratum } from './flopBatches'
import allFlopsJson from './flopsAll.json'

const flops = allFlopsJson as FlopDef[]

function proportions(items: readonly FlopDef[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const flop of items) {
    const stratum = flopTextureStratum(flop)
    counts.set(stratum, (counts.get(stratum) ?? 0) + 1)
  }
  return new Map([...counts].map(([stratum, count]) => [stratum, count / items.length]))
}

describe('フロップの層化バッチ分割', () => {
  it('指定件数で全フロップを重複なく決定的に分割する', () => {
    const first = createStratifiedFlopBatches(flops, 100)
    const second = createStratifiedFlopBatches(flops, 100)
    expect(first).toEqual(second)
    expect(first).toHaveLength(18)
    expect(first.slice(0, -1).every((batch) => batch.length === 100)).toBe(true)
    expect(first.at(-1)).toHaveLength(55)

    const flattened = first.flat()
    expect(flattened).toHaveLength(flops.length)
    expect(new Set(flattened.map((flop) => flop.cards.join(','))).size).toBe(flops.length)
  })

  it('各バッチの構成比が全体から大きく偏らない', () => {
    const overall = proportions(flops)
    const batches = createStratifiedFlopBatches(flops, 100)

    for (const batch of batches) {
      const batchProportions = proportions(batch)
      expect(batchProportions.size).toBeGreaterThanOrEqual(4)
      for (const [stratum, expected] of overall) {
        const actual = batchProportions.get(stratum) ?? 0
        expect(Math.abs(actual - expected), `${stratum}: ${actual} vs ${expected}`).toBeLessThan(0.04)
      }
    }
  })

  it('不正なbatchSizeを拒否し、空入力は空配列にする', () => {
    expect(() => createStratifiedFlopBatches(flops, 0)).toThrow(RangeError)
    expect(() => createStratifiedFlopBatches(flops, 1.5)).toThrow(RangeError)
    expect(createStratifiedFlopBatches([], 100)).toEqual([])
  })
})
