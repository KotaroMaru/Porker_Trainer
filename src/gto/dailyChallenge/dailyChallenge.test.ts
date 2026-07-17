import { afterEach, describe, expect, it } from 'vitest'
import { FLOPS, pickWeightedFlop } from '../data/flops'
import { SCENARIOS, pickWeightedScenario } from '../data/scenarios'
import { applyDailyResultToRank, computeDailyScore, pickDailySpotSeeds, DAILY_RATING_INITIAL } from './dailyChallenge'
import { createSeededRng } from './seededRng'
import { loadDailyRank, loadDailyResults, saveDailyRank, saveDailyResult } from './storage'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key), clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null, get length() { return values.size } } as Storage
}

describe('daily challenge deterministic selection', () => {
  it('同じseedは同じ乱数列を返す', () => {
    const first = createSeededRng('2026-07-17')
    const second = createSeededRng('2026-07-17')
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second))
  })

  it('同じ日付は同じシナリオ・フロップ列、別日は異なる列を作る', () => {
    const select = (date: string) => pickDailySpotSeeds(date, 10).map((seed) => `${pickWeightedScenario(SCENARIOS, seed.scenarioRng).id}/${pickWeightedFlop(FLOPS, seed.flopRng).cards.join('')}`)
    expect(select('2026-07-17')).toEqual(select('2026-07-17'))
    expect(select('2026-07-17')).not.toEqual(select('2026-07-18'))
  })

  it('重み付き抽選は注入したrngに従い、デフォルトもプールから返す', () => {
    expect(pickWeightedScenario(SCENARIOS, () => 0)).toBe(SCENARIOS[0])
    expect(pickWeightedFlop(FLOPS, () => 0)).toBe(FLOPS[0])
    expect(SCENARIOS).toContain(pickWeightedScenario())
    expect(FLOPS).toContain(pickWeightedFlop())
  })

  it('スコアを0〜100に収め、ランク変動を±10へ制限する', () => {
    const score = computeDailyScore([{ verdict: 'correct', evLossBb: 0 }, { verdict: 'marginal', evLossBb: 1 }, { verdict: 'incorrect', evLossBb: 10 }])
    expect(score.correctCount).toBe(1)
    expect(score.totalEvLossBb).toBe(11)
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.score).toBeLessThanOrEqual(100)
    expect(applyDailyResultToRank(1000, 100) - 1000).toBeLessThanOrEqual(10)
    expect(applyDailyResultToRank(1000, 0) - 1000).toBeGreaterThanOrEqual(-10)
  })
})

describe('daily challenge storage', () => {
  const original = globalThis.localStorage
  afterEach(() => Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true }))

  it('日別結果とランクを永続化し、未対応環境では既定値へ戻る', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
    saveDailyResult('2026-07-17', { score: 80, correctCount: 8, totalEvLossBb: 1.5, handCount: 10 })
    saveDailyRank(1008)
    expect(loadDailyResults()['2026-07-17']).toMatchObject({ score: 80, correctCount: 8 })
    expect(loadDailyRank()).toBe(1008)
  })

  it('未保存(初回アクセス)ではDAILY_RATING_INITIALを返す(Number(null)===0による誤フォールバック回避)', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
    expect(loadDailyRank()).toBe(DAILY_RATING_INITIAL)
  })
})
