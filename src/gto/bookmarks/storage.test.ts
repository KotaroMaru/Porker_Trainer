/// <reference types="node" />
// P6 Step B10: storage.tsのテスト。このテスト環境のglobalThis.localStorageは
// メソッド呼び出しが例外を投げる制約があるため(settings.test.tsで確認済み)、
// Mapベースの簡易実装に差し替えて検証する。実.binフィクスチャからbuildReviewした
// 単発レビューを保存対象に使う。

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { saveBookmark, listBookmarks, loadBookmark, deleteBookmark, BOOKMARK_CAP } from './storage'
import { buildReview, type ReviewData } from '../trainer/reviewBuilder'
import { createSpot, applyUserAction } from '../trainer/gameFlow'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { cardKey } from '../../engine/deck'
import type { FlopDef } from '../types'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

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

describe('bookmarks/storage (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flopOrUndefined) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  const flop: FlopDef = flopOrUndefined
  let solution: DecodedSolution
  let review: ReviewData

  const originalLocalStorage = globalThis.localStorage

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', FLOP_STR + '.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)

    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    review = buildReview(spot, grading, chosenLabel)
  })

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('save→list→load→deleteの一連の往復が正しく動作する', () => {
    const result = saveBookmark(review, { mode: 'single', netBb: null })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const list = listBookmarks()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(result.id)
    expect(list[0].scenarioId).toBe(review.scenario.id)
    expect(list[0].verdicts).toEqual(review.decisions.map((d) => d.grading.verdict))
    expect(list[0].mode).toBe('single')
    expect(list[0].netBb).toBeNull()

    const loaded = loadBookmark(result.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.board.map(cardKey)).toEqual(review.board.map(cardKey))
    expect(loaded!.decisions.length).toBe(review.decisions.length)

    deleteBookmark(result.id)
    expect(listBookmarks().length).toBe(0)
    expect(loadBookmark(result.id)).toBeNull()
  })

  it('複数保存すると新しい順(先頭が最新)でlistBookmarksに並ぶ', () => {
    const first = saveBookmark(review, { mode: 'single', netBb: null })
    const second = saveBookmark(review, { mode: 'full', netBb: 4.2 })
    if (!first.ok || !second.ok) throw new Error('unreachable')

    const list = listBookmarks()
    expect(list.map((m) => m.id)).toEqual([second.id, first.id])
    expect(list[0].mode).toBe('full')
    expect(list[0].netBb).toBe(4.2)
  })

  it('CAP(200件)に達している場合はsaveBookmarkがreason:capで失敗する', () => {
    // indexだけを直接200件分埋める(本体データまで200回エンコードするのは不要)。
    const bulk = Array.from({ length: BOOKMARK_CAP }, (_, i) => ({
      id: `bm_bulk_${i}`,
      createdAt: Date.now(),
      scenarioId: 'srp_btn_vs_bb',
      scenarioLabel: 'dummy',
      boardStr: 'dummy',
      verdicts: [],
      netBb: null,
      mode: 'single' as const,
    }))
    localStorage.setItem('poker_trainer_gto_bookmarks_index', JSON.stringify(bulk))

    const result = saveBookmark(review, { mode: 'single', netBb: null })
    expect(result).toEqual({ ok: false, reason: 'cap' })
    expect(listBookmarks().length).toBe(BOOKMARK_CAP) // 失敗時は追加されない
  })

  it('localStorage.setItemが例外を投げる(quota超過)場合、reason:quotaで失敗し中途半端なデータを残さない', () => {
    const stub = createMemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        ...stub,
        setItem: () => {
          throw new DOMException('quota exceeded', 'QuotaExceededError')
        },
      },
      configurable: true,
    })

    const result = saveBookmark(review, { mode: 'single', netBb: null })
    expect(result).toEqual({ ok: false, reason: 'quota' })
    expect(listBookmarks().length).toBe(0)
  })

  it('index書き込みだけがquotaで失敗した場合、先に書き込んだ本体データをロールバックする', () => {
    const map = new Map<string, string>()
    let indexWriteCount = 0
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === 'poker_trainer_gto_bookmarks_index') {
            indexWriteCount++
            throw new DOMException('quota exceeded', 'QuotaExceededError')
          }
          map.set(key, value)
        },
        removeItem: (key: string) => {
          map.delete(key)
        },
      },
      configurable: true,
    })

    const result = saveBookmark(review, { mode: 'single', netBb: null })
    expect(result).toEqual({ ok: false, reason: 'quota' })
    expect(indexWriteCount).toBe(1)
    // 本体データ(poker_trainer_gto_bookmark_<id>)がロールバックされ、mapに何も残っていない。
    expect(map.size).toBe(0)
  })
})
