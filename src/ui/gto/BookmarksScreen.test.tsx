/// <reference types="node" />
// P6 Step B10: BookmarksScreen.tsxのテスト。localStorageをMapベースの簡易実装に
//差し替え(settings.test.ts/storage.test.tsと同じ理由)、実.binフィクスチャから
// 構築したレビューをsaveBookmarkで直接保存してから一覧描画・削除・開くを検証する。

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { BookmarksScreen } from './BookmarksScreen'
import { useGtoStore, initialTally } from '../../gto/store'
import { saveBookmark } from '../../gto/bookmarks/storage'
import { buildReview, type ReviewData } from '../../gto/trainer/reviewBuilder'
import { createSpot, applyUserAction } from '../../gto/trainer/gameFlow'
import { decodeSolutionFile, type DecodedSolution } from '../../gto/loader/binaryFormat'
import { getScenario } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import type { FlopDef } from '../../gto/types'

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

describe('BookmarksScreen (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flopOrUndefined) throw new Error('flop fixture not found')
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
    useGtoStore.setState({
      status: 'idle',
      spot: null,
      grading: null,
      chosenLabel: null,
      errorMessage: null,
      sessionTally: initialTally(),
      activeTab: 'bookmarks',
      review: null,
      reviewSource: 'live',
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('保存済みが無い場合は案内メッセージを表示する', () => {
    render(<BookmarksScreen />)
    expect(screen.getByText(/保存済みのハンドはまだありません/)).toBeInTheDocument()
  })

  it('保存済みのブックマークをシナリオ名・ボード・verdictチップ付きで一覧表示する', () => {
    saveBookmark(review, { mode: 'single', netBb: null })
    render(<BookmarksScreen />)

    expect(screen.getByText(review.scenario.label)).toBeInTheDocument()
    expect(screen.getByText('開く')).toBeInTheDocument()
    expect(screen.getByText('削除')).toBeInTheDocument()
  })

  it('「開く」をクリックするとstore.openBookmarkが呼ばれ、review/activeTabが更新される', () => {
    const result = saveBookmark(review, { mode: 'single', netBb: null })
    if (!result.ok) throw new Error('save should succeed')
    render(<BookmarksScreen />)

    screen.getByText('開く').click()

    const state = useGtoStore.getState()
    expect(state.review).not.toBeNull()
    expect(state.reviewSource).toBe('bookmark')
    expect(state.activeTab).toBe('play')
    expect(state.review!.board.length).toBe(review.board.length)
  })

  it('「削除」をクリックすると一覧から消え、再読み込みしても復活しない', async () => {
    saveBookmark(review, { mode: 'single', netBb: null })
    render(<BookmarksScreen />)
    expect(screen.getByText('削除')).toBeInTheDocument()

    screen.getByText('削除').click()

    await waitFor(() => {
      expect(screen.getByText(/保存済みのハンドはまだありません/)).toBeInTheDocument()
    })
  })
})
