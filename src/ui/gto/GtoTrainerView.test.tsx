/// <reference types="node" />
// P6 Step B10: GtoTrainerViewの結合テスト。「保存済み」タブでブックマークを開くと
// 「プレイ」タブへ自動遷移し、ReviewScreenが解説を再計算して描画することを確認する
// (codec.tsはGradeResult/explanation/featuresを保存しないため、開いた時点で
// computeSpotFeatures/gradeDecisionが再実行される、という不変条件のE2E的な検証)。

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { GtoTrainerView } from './GtoTrainerView'
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

describe('GtoTrainerView (実.binフィクスチャによる結合テスト, P6 B10)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flopOrUndefined) throw new Error('flop fixture not found')
  const flop: FlopDef = flopOrUndefined
  let solution: DecodedSolution
  let review: ReviewData

  const originalFetch = globalThis.fetch
  const originalLocalStorage = globalThis.localStorage

  beforeAll(async () => {
    // GtoTrainerViewマウント時にPlayScreen/SettingsScreenがloadAvailability()を
    // 呼びうるため(manifest.json)、実ネットワークへ出ないよう404で応答するスタブにする。
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch

    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', FLOP_STR + '.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)

    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    review = buildReview(spot, grading, chosenLabel)
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
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
      fullHand: null,
      fullHandController: null,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('保存済みブックマークを「開く」とプレイタブへ自動遷移し、ReviewScreenが解説を再計算して描画する', async () => {
    const result = saveBookmark(review, { mode: 'single', netBb: null })
    if (!result.ok) throw new Error('save should succeed')

    render(<GtoTrainerView />)

    // 「保存済み」タブに切り替えてブックマークを開く
    screen.getByText('保存済み').click()
    await waitFor(() => {
      expect(screen.getByText('開く')).toBeInTheDocument()
    })
    screen.getByText('開く').click()

    // 自動的に「プレイ」タブへ遷移し、ReviewScreenの内容(判定・解説)が描画される
    await waitFor(() => {
      expect(screen.getByText(/が最善|境界上の手/)).toBeInTheDocument()
    })
    expect(screen.getByText('ボード')).toBeInTheDocument()
    expect(screen.getByText('一覧へ戻る')).toBeInTheDocument()
  })
})
