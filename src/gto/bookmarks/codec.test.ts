/// <reference types="node" />
// P6 Step B10: codec.tsのテスト。実.binフィクスチャベースの単発レビューと、
// それを合成した複数決断(通しモード相当)レビューの両方でエンコード→デコードの
// 往復を検証する(freq誤差1/255以内・EV誤差0.01bb以内・verdict同一)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeReview, decodeReview, toBase64, fromBase64, BOOKMARK_CODEC_VERSION } from './codec'
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

describe('bookmarks/codec (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flopOrUndefined) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  const flop: FlopDef = flopOrUndefined
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', FLOP_STR + '.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  function buildRealReview(): ReviewData {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    return buildReview(spot, grading, chosenLabel)
  }

  it('単発レビュー(実データ)のエンコード→デコード往復で、ボード・手・履歴・シナリオが完全一致する', () => {
    const review = buildRealReview()
    const bytes = encodeReview(review)
    const decoded = decodeReview(bytes)

    expect(decoded.scenario.id).toBe(review.scenario.id)
    expect(decoded.flop.cards).toEqual(review.flop.cards)
    expect(decoded.board.map(cardKey)).toEqual(review.board.map(cardKey))
    expect(decoded.userCombo.map(cardKey)).toEqual(review.userCombo.map(cardKey))
    expect(decoded.userPosition).toBe(review.userPosition)
    expect(decoded.botPosition).toBe(review.botPosition)
    expect(decoded.history).toEqual(review.history)
    expect(decoded.decisions.length).toBe(review.decisions.length)
  })

  it('決断内のfreq誤差は1/255以内、EV誤差は0.01bb以内、verdictは完全一致する', () => {
    const review = buildRealReview()
    const bytes = encodeReview(review)
    const decoded = decodeReview(bytes)

    const orig = review.decisions[0]
    const dec = decoded.decisions[0]

    expect(dec.decodedNode.actionLabels).toEqual(orig.decodedNode.actionLabels)
    expect(dec.decodedNode.freqs.length).toBe(orig.decodedNode.freqs.length)
    for (let i = 0; i < orig.decodedNode.freqs.length; i++) {
      expect(Math.abs(dec.decodedNode.freqs[i] - orig.decodedNode.freqs[i])).toBeLessThanOrEqual(1 / 255 + 1e-9)
    }
    for (let i = 0; i < orig.decodedNode.evsBb.length; i++) {
      expect(Math.abs(dec.decodedNode.evsBb[i] - orig.decodedNode.evsBb[i])).toBeLessThanOrEqual(0.01)
    }
    expect(dec.grading.verdict).toBe(orig.grading.verdict)
    expect(dec.grading.bestLabel).toBe(orig.grading.bestLabel)
  })

  it('heroWeights/villainWeightsは相対誤差が小さく、合計もほぼ1のまま保たれる', () => {
    const review = buildRealReview()
    const decoded = decodeReview(encodeReview(review))
    const orig = review.decisions[0]
    const dec = decoded.decisions[0]

    expect(dec.heroCombos.length).toBe(orig.heroCombos.length)
    const origSum = orig.heroWeights.reduce((a, b) => a + b, 0)
    const decSum = dec.heroWeights.reduce((a, b) => a + b, 0)
    expect(decSum).toBeCloseTo(origSum, 2)

    for (let i = 0; i < orig.heroWeights.length; i++) {
      // u16量子化(スケール=最大重み)なので絶対誤差は最大重み/65535程度。相対誤差1%未満を確認する。
      const maxW = Math.max(...orig.heroWeights)
      expect(Math.abs(dec.heroWeights[i] - orig.heroWeights[i])).toBeLessThan(maxW * 0.001 + 1e-9)
    }
  })

  it('レスポンスノード(responseNodes)もラベル・戦略ともに往復する', () => {
    const review = buildRealReview()
    const decoded = decodeReview(encodeReview(review))
    const orig = review.decisions[0]
    const dec = decoded.decisions[0]

    expect(dec.responseNodes.map((r) => r.forLabel)).toEqual(orig.responseNodes.map((r) => r.forLabel))
    expect(dec.responseNodes.map((r) => r.nodeId)).toEqual(orig.responseNodes.map((r) => r.nodeId))
    for (let i = 0; i < orig.responseNodes.length; i++) {
      expect(dec.responseNodes[i].node.actionLabels).toEqual(orig.responseNodes[i].node.actionLabels)
    }
  })

  it('base64往復(toBase64/fromBase64)を経由してもバイト列が完全一致する', () => {
    const review = buildRealReview()
    const bytes = encodeReview(review)
    const roundTripped = fromBase64(toBase64(bytes))
    expect([...roundTripped]).toEqual([...bytes])
  })

  it('未対応バージョンのバイト列を渡すとエラーを投げる', () => {
    const review = buildRealReview()
    const bytes = encodeReview(review)
    const corrupted = new Uint8Array(bytes)
    corrupted[0] = BOOKMARK_CODEC_VERSION + 1
    expect(() => decodeReview(corrupted)).toThrow(/version/)
  })

  it('合成した複数決断(通しモード相当)のレビューも、街・ボード・決断数が往復する', () => {
    const baseReview = buildRealReview()
    const flopDecision = { ...baseReview.decisions[0], street: 'flop' as const, boardAtDecision: baseReview.board }
    const turnDecision = { ...baseReview.decisions[0], street: 'turn' as const, nodeId: 'check-check', boardAtDecision: baseReview.board }
    const syntheticReview: ReviewData = { ...baseReview, decisions: [flopDecision, turnDecision] }

    const decoded = decodeReview(encodeReview(syntheticReview))

    expect(decoded.decisions.length).toBe(2)
    expect(decoded.decisions.map((d) => d.street)).toEqual(['flop', 'turn'])
    expect(decoded.decisions[1].nodeId).toBe('check-check')
    expect(decoded.decisions.map((d) => d.boardAtDecision.map(cardKey))).toEqual(decoded.decisions.map(() => baseReview.board.map(cardKey)))
  })
})
