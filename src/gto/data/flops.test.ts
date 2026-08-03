import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FlopDef } from '../types'
import allFlopsJson from './flopsAll.json'
import scenarioJson from '../../../tools/solver/scenarios/srp_btn_vs_bb.json'
import { FLOPS, pickWeightedFlop } from './flops'

const RANK_CHARS = new Set(['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'])
const SUIT_CHARS = new Set(['c', 'd', 'h', 's'])
const WEIGHT_TOLERANCE = 1e-12
const allFlops = allFlopsJson as FlopDef[]
const dataDirectory = dirname(fileURLToPath(import.meta.url))
const solutionDirectory = join(dataDirectory, '../../../public/gto/solutions/srp_btn_vs_bb')

function cardsKey(flop: FlopDef): string {
  return flop.cards.join('')
}

function normalizedWeight(flops: readonly FlopDef[], predicate: (flop: FlopDef) => boolean): number {
  const total = flops.reduce((sum, flop) => sum + flop.weight, 0)
  return flops.filter(predicate).reduce((sum, flop) => sum + flop.weight, 0) / total
}

describe('対応フロップ300種', () => {
  it('300件のフロップが定義されている', () => {
    expect(FLOPS).toHaveLength(300)
  })

  it('全要素がflopsAll.jsonに表記まで一致し、真のweightは正である', () => {
    const allByCards = new Map(allFlops.map((flop) => [cardsKey(flop), flop]))
    for (const flop of FLOPS) {
      const populationFlop = allByCards.get(cardsKey(flop))
      expect(populationFlop, cardsKey(flop)).toBeDefined()
      expect(flop).toEqual(populationFlop)
      expect(flop.weight).toBeGreaterThan(0)
      expect(Math.abs(flop.weight - (populationFlop?.weight ?? 0))).toBeLessThanOrEqual(WEIGHT_TOLERANCE)
    }
  })

  it('生成済み.binの95フロップをすべて同じ表記で保持する', () => {
    const solvedFlops = readdirSync(solutionDirectory)
      .filter((name) => name.endsWith('.bin'))
      .map((name) => name.slice(0, -'.bin'.length))
    const selectedCards = new Set(FLOPS.map(cardsKey))

    expect(solvedFlops).toHaveLength(95)
    for (const cards of solvedFlops) expect(selectedCards.has(cards), cards).toBe(true)
  })

  it('srp_btn_vs_bbシナリオと同じ300件を同じ表記・順序で持つ', () => {
    expect(scenarioJson.flops).toEqual(FLOPS.map(cardsKey))
  })

  it('真の出現確率で見たテクスチャ構成比が母集団から極端に偏らない', () => {
    const predicates = {
      monotone: (flop: FlopDef) => flop.texture.monotone,
      rainbow: (flop: FlopDef) => !flop.texture.monotone && !flop.texture.twoTone,
      twoTone: (flop: FlopDef) => flop.texture.twoTone,
      paired: (flop: FlopDef) => flop.texture.paired,
    }

    for (const [texture, predicate] of Object.entries(predicates)) {
      const selected = normalizedWeight(FLOPS, predicate)
      const population = normalizedWeight(allFlops, predicate)
      expect(Math.abs(selected - population), `${texture}: ${selected} vs ${population}`).toBeLessThan(0.04)
    }
  })

  it('各フロップのカードは正しい表記(ランク+スート)で重複しない', () => {
    for (const flop of FLOPS) {
      expect(flop.cards).toHaveLength(3)
      const seen = new Set<string>()
      for (const card of flop.cards) {
        expect(RANK_CHARS.has(card[0]), card).toBe(true)
        expect(SUIT_CHARS.has(card[1]), card).toBe(true)
        expect(seen.has(card), `duplicate card ${card} in ${flop.cards}`).toBe(false)
        seen.add(card)
      }
    }
  })

  it('フロップの組み合わせ自体に重複がない', () => {
    const keys = FLOPS.map((flop) => [...flop.cards].sort().join(','))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('pickWeightedFlopは渡されたプールのweight合計で再正規化する', () => {
    const pool = [FLOPS[0], FLOPS[1]]
    const firstShare = pool[0].weight / (pool[0].weight + pool[1].weight)
    expect(pickWeightedFlop(pool, () => 0)).toBe(pool[0])
    expect(pickWeightedFlop(pool, () => firstShare + Number.EPSILON)).toBe(pool[1])
  })
})
