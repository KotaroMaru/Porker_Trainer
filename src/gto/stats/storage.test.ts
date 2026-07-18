// P11 Phase D-2: storage.tsのテスト。このテスト環境のglobalThis.localStorageは
// メソッド呼び出しが例外を投げる制約があるため(settings.test.ts/bookmarks/storage.test.ts
// で確認済み)、Mapベースの簡易実装に差し替えて往復を検証する。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadDivergenceTally, saveDivergenceTally, resetDivergenceTally } from './storage'
import { initialDivergenceTally, accumulateDivergence } from './divergence'
import type { ActionBreakdownEntry } from '../trainer/grading'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const SAMPLE_BREAKDOWN: ActionBreakdownEntry[] = [
  { label: 'fold', freq: 0.3, evBb: -1 },
  { label: 'check', freq: 0.5, evBb: 0 },
  { label: 'bet33', freq: 0.2, evBb: 1 },
]

describe('gto/stats/storage (localStorage永続化)', () => {
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('未保存時はinitialDivergenceTally()を返す', () => {
    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())
  })

  it('save→loadで往復する', () => {
    const tally = accumulateDivergence(initialDivergenceTally(), SAMPLE_BREAKDOWN, 'fold')
    saveDivergenceTally(tally)
    expect(loadDivergenceTally()).toEqual(tally)
  })

  it('複数回accumulateした後もsave→loadで往復する', () => {
    let tally = initialDivergenceTally()
    tally = accumulateDivergence(tally, SAMPLE_BREAKDOWN, 'fold')
    tally = accumulateDivergence(tally, SAMPLE_BREAKDOWN, 'check')
    tally = accumulateDivergence(tally, SAMPLE_BREAKDOWN, 'bet33')
    saveDivergenceTally(tally)
    expect(loadDivergenceTally()).toEqual(tally)
  })

  it('resetDivergenceTallyでlocalStorageから削除され、以後の読み込みは初期値になる', () => {
    const tally = accumulateDivergence(initialDivergenceTally(), SAMPLE_BREAKDOWN, 'fold')
    saveDivergenceTally(tally)
    expect(loadDivergenceTally()).toEqual(tally)

    resetDivergenceTally()
    expect(localStorage.getItem('poker_trainer_gto_divergence')).toBeNull()
    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())
  })

  it('壊れたJSONが保存されている場合はinitialDivergenceTally()にフォールバックする', () => {
    localStorage.setItem('poker_trainer_gto_divergence', '{not valid json')
    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())
  })

  it('形が不正なデータ(decisionCountが数値でない・bucketキー欠落)はinitialDivergenceTally()にフォールバックする', () => {
    localStorage.setItem('poker_trainer_gto_divergence', JSON.stringify({ decisionCount: 'not-a-number' }))
    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())

    localStorage.setItem(
      'poker_trainer_gto_divergence',
      JSON.stringify({ decisionCount: 3, userCount: { fold: 1, passive: 2 }, gtoFreqSum: { fold: 1, passive: 1, aggressive: 1 } }),
    )
    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())
  })

  it('localStorage自体が使えない環境(プライベートブラウジング等)ではloadは初期値・saveは例外を投げない', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      },
      configurable: true,
    })

    expect(loadDivergenceTally()).toEqual(initialDivergenceTally())
    expect(() => saveDivergenceTally(initialDivergenceTally())).not.toThrow()
    expect(() => resetDivergenceTally()).not.toThrow()
  })
})
