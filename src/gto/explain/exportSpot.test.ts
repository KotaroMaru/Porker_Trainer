/// <reference types="node" />
// P5 Step B5: exportSpot.tsのテスト。実.binフィクスチャで統合的に検証する。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSpotMarkdown } from './exportSpot'
import { computeSpotFeatures } from './features'
import { buildExplanation } from './templates'
import { buildReview } from '../trainer/reviewBuilder'
import { createSpot, applyUserAction } from '../trainer/gameFlow'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import type { FlopDef } from '../types'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

describe('buildSpotMarkdown (実.binフィクスチャによる統合テスト)', () => {
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

  it('features/explanation=nullでも例外なく必須セクションを含むmarkdownを生成する', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    const review = buildReview(spot, grading, chosenLabel)

    const md = buildSpotMarkdown(review, 0, null, null)

    expect(md).toContain('# GTOポストフロップスポット')
    expect(md).toContain('## シナリオ')
    expect(md).toContain('## ボード')
    expect(md).toContain('## 自分の手')
    expect(md).toContain('## 履歴')
    expect(md).toContain('## この決断')
    expect(md).toContain('## GTO戦略(このノード)')
    expect(md).toContain('## 両者のレンジ(この決断到達時点)')
    expect(md).toContain('## 特徴量')
    expect(md).toContain('## 解説')
    expect(md).toContain('この状況について質問')
    expect(md).not.toContain('NaN')
    expect(md).not.toContain('undefined')
  })

  it('features/explanationありの場合、その内容がmarkdownに反映される', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    const review = buildReview(spot, grading, chosenLabel)
    const features = computeSpotFeatures(review, 0)
    const explanation = buildExplanation(review.decisions[0], features)

    const md = buildSpotMarkdown(review, 0, features, explanation)

    expect(md).toContain('ハンドクラス')
    expect(md).toContain(explanation.headline)
    expect(md).toContain(explanation.sameClassLine)
    expect(md).not.toContain('NaN')
    expect(md).not.toContain('undefined')
  })

  it('両者のレンジ表記にはボードで使われたカードやscored freqが含まれ、GTO戦略表はアクション数分の行を持つ', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    const review = buildReview(spot, grading, chosenLabel)
    const md = buildSpotMarkdown(review, 0, null, null)

    // GTO戦略表: ヘッダ2行 + アクション数分の行
    const tableLines = md.split('\n').filter((l) => l.startsWith('|'))
    expect(tableLines.length).toBe(2 + spot.decodedNode.actionLabels.length)

    // レンジ要約: 少なくとも1つのハンド表記(大文字ランク文字を含む)が出力される
    expect(md).toMatch(/[AKQJT2-9]{2,3}\s+\d+%/)
  })

  it('この決断セクションにストリートと決断時点のボードが出力される(P6 B6)', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    const review = buildReview(spot, grading, chosenLabel)

    const md = buildSpotMarkdown(review, 0, null, null)

    expect(md).toContain('ストリート: フロップ')
    expect(md).toContain('この決断時点のボード')
  })

  it('存在しないdecisionIndexを渡すとエラーを投げる', () => {
    const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
    const chosenLabel = spot.decodedNode.actionLabels[0]
    const grading = applyUserAction(spot, chosenLabel)
    const review = buildReview(spot, grading, chosenLabel)

    expect(() => buildSpotMarkdown(review, 5, null, null)).toThrow()
  })
})
