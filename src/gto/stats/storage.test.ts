import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accumulateDivergenceStats, initialDivergenceStats, type DivergenceTally } from './divergence'
import { loadDivergenceTally, resetDivergenceTally, saveDivergenceTally } from './storage'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

describe('divergence storage v2', () => {
  const original = globalThis.localStorage
  beforeEach(() => Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }))
  afterEach(() => Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true }))

  it('v2を保存して次元集計ごと往復する', () => {
    const stats = accumulateDivergenceStats(
      initialDivergenceStats(),
      [{ label: 'fold', freq: 0.4, evBb: 0 }, { label: 'call', freq: 0.6, evBb: 0 }],
      'call',
      { street: 'turn', flopPath: 'check-check', texture: { monotone: false, twoTone: true, paired: false }, focusScenarioId: 'srp_btn_vs_bb' },
    )
    saveDivergenceTally(stats)
    expect(loadDivergenceTally()).toEqual(stats)
  })

  it('旧形式を捨てずX用の全体集計へ移し、条件付きfoldは0から集計する', () => {
    const legacy: DivergenceTally = {
      decisionCount: 42,
      userCount: { fold: 8, passive: 20, aggressive: 14 },
      gtoFreqSum: { fold: 10, passive: 18, aggressive: 14 },
    }
    localStorage.setItem('poker_trainer_gto_divergence', JSON.stringify(legacy))
    const migrated = loadDivergenceTally()
    expect(migrated.decisionCount).toBe(42)
    expect(migrated.userCount).toEqual(legacy.userCount)
    expect(migrated.gtoFreqSum).toEqual(legacy.gtoFreqSum)
    expect(migrated.legacyDecisionCount).toBe(42)
    expect(migrated.foldEligibleCount).toBe(0)
  })

  it('破損値は初期値へ戻り、resetで保存値を削除する', () => {
    localStorage.setItem('poker_trainer_gto_divergence', '{broken')
    expect(loadDivergenceTally()).toEqual(initialDivergenceStats())
    saveDivergenceTally(initialDivergenceStats())
    resetDivergenceTally()
    expect(localStorage.getItem('poker_trainer_gto_divergence')).toBeNull()
  })

  it('localStorageが例外を投げても練習を止めない', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }, configurable: true })
    expect(loadDivergenceTally()).toEqual(initialDivergenceStats())
    expect(() => saveDivergenceTally(initialDivergenceStats())).not.toThrow()
    expect(() => resetDivergenceTally()).not.toThrow()
  })
})
