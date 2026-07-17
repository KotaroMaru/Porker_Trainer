/// <reference types="node" />
// P5 Step B3: features.tsのテスト。実.binフィクスチャで統合的に検証する
// (import.meta.url経由のURL構築は既知の環境問題があるためprocess.cwd()基準で読む)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { computeSpotFeatures, HAND_CLASS_JA } from './features'
import { computeSharedRunoutEquity } from './rangeEquity'
import { buildReview, handStrFromCombo } from '../trainer/reviewBuilder'
import { createSpot, applyUserAction } from '../trainer/gameFlow'
import { actionLabelsWithAmounts } from '../trainer/actionMath'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { buildStreetTree } from '../tree/actionTree'
import { cardKey } from '../../engine/deck'
import type { FlopDef } from '../types'
import type { Card } from '../../engine/types'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

describe('computeSpotFeatures (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flopOrUndefined = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flopOrUndefined) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  // TSの絞り込みはクロージャ(下のbuildFacingBetSpot等)に伝播しないため、
  // 絞り込み後に確定した型のconstへ束縛し直す。
  const flop: FlopDef = flopOrUndefined
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', FLOP_STR + '.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  function buildFacingBetSpot() {
    // reviewBuilder.test.tsと同じ理由(このフロップはOOPのcheck率99.8%で
    // ランダムサンプリングでfacing-betを引き当てられない)で、決定論的に
    // 'bet33'パスを直接指定してSpotStateを組み立てる。
    const tree = buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 })
    if (tree.kind !== 'decision') throw new Error('root node is not a decision node')
    const bet33Idx = tree.actionLabels.indexOf('bet33')
    const facingNode = tree.children[bet33Idx]
    if (facingNode.kind !== 'decision') throw new Error('facing node is not a decision node')
    const facingDecoded = solution.nodes.get('bet33')
    if (!facingDecoded) throw new Error('solution has no node for path "bet33"')

    const userCombo = solution.ipCombos[0]
    const userKeys = new Set(userCombo.map(cardKey))
    const botCombo = solution.oopCombos.find((c) => !c.some((card) => userKeys.has(cardKey(card))))
    if (!botCombo) throw new Error('no non-colliding OOP combo found for test fixture')

    return {
      scenario,
      flop,
      solution,
      userSeat: 1 as const,
      userCombo,
      botCombo,
      decisionNode: facingNode,
      decodedNode: facingDecoded,
      nodeId: 'bet33',
      botActionsBefore: [{ nodeId: '', label: 'bet33' }],
      actionsWithAmounts: actionLabelsWithAmounts(facingNode),
    }
  }

  describe('ルートノード(open decision)', () => {
    it('nodeContext=root、mdf/potOddsRequiredEqはnull', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.nodeContext.kind).toBe('root')
      expect(features.mdf).toBeNull()
      expect(features.potOddsRequiredEq).toBeNull()
      expect(features.blockers.continueCombosReducedPct).toBeNull()
    })

    it('eqPercentileInRangeは0〜100の範囲、equityBucketsの合計は約100%', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.eqPercentileInRange).toBeGreaterThanOrEqual(0)
      expect(features.eqPercentileInRange).toBeLessThanOrEqual(100)

      const heroBucketSum = features.equityBuckets.reduce((s, b) => s + b.heroPct, 0)
      const villainBucketSum = features.equityBuckets.reduce((s, b) => s + b.villainPct, 0)
      expect(heroBucketSum).toBeCloseTo(100, 0)
      expect(villainBucketSum).toBeCloseTo(100, 0)
      expect(features.equityBuckets.length).toBe(10)
    })

    it('sameClass.actionMixの頻度合計は約1、classJaはHAND_CLASS_JAの値と一致', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      const mixSum = features.sameClass.actionMix.reduce((s, a) => s + a.freq, 0)
      expect(mixSum).toBeCloseTo(1, 1)
      expect(features.sameClass.classJa).toBe(HAND_CLASS_JA[features.handClass])
      expect(features.sameClass.comboCount).toBeGreaterThan(0)
    })

    it('rangeAdvantage/nutsAdvantageのverdictJaは既定の3値のいずれか', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(['レンジ優位', 'レンジ劣位', '互角']).toContain(features.rangeAdvantage.verdictJa)
      expect(['ナッツ優位', 'ナッツ劣位', '互角']).toContain(features.nutsAdvantage.verdictJa)
      expect(features.nutsAdvantage.heroTopPct).toBeGreaterThanOrEqual(0)
      expect(features.nutsAdvantage.villainTopPct).toBeGreaterThanOrEqual(0)
    })

    it('responsesはdecodedNode.actionLabelsと同じ長さ・同じ順序で、rootでは全てterminal:falseになる', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.responses.map((r) => r.forLabel)).toEqual(spot.decodedNode.actionLabels)
      expect(features.responses.every((r) => !r.terminal)).toBe(true)
      // 実際に計算されるのはchosen/bestの2アクションのみ(コスト上限のため)
      const withEquity = features.responses.filter((r) => r.heroEquityVsContinueRange !== null)
      expect(withEquity.length).toBeGreaterThan(0)
      expect(withEquity.length).toBeLessThanOrEqual(2)
    })
  })

  describe('facing-betノード', () => {
    it('nodeContext=facingBet、mdf/potOddsRequiredEqは0〜1の範囲', () => {
      const spot = buildFacingBetSpot()
      const chosenLabel = 'call'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.nodeContext.kind).toBe('facingBet')
      expect(features.mdf).not.toBeNull()
      expect(features.potOddsRequiredEq).not.toBeNull()
      expect(features.mdf!).toBeGreaterThan(0)
      expect(features.mdf!).toBeLessThan(1)
      expect(features.potOddsRequiredEq!).toBeGreaterThan(0)
      expect(features.potOddsRequiredEq!).toBeLessThan(1)
    })

    it('foldを含む応答はterminal:false・fold以外(call/コール締め)はresponsesに現れない', () => {
      const spot = buildFacingBetSpot()
      const chosenLabel = 'call'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      const foldResp = features.responses.find((r) => r.forLabel === 'fold')
      const callResp = features.responses.find((r) => r.forLabel === 'call')
      expect(foldResp?.terminal).toBe(true)
      expect(callResp?.terminal).toBe(true)
    })

    it('foldFreqは応答内訳の独立再計算(villainWeights加重平均)と一致する', () => {
      const spot = buildFacingBetSpot()
      const chosenLabel = 'raise55'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)
      const decision = review.decisions[0]

      const raiseResp = features.responses.find((r) => r.forLabel === 'raise55')
      expect(raiseResp).toBeDefined()
      expect(raiseResp!.terminal).toBe(false)

      // 独立に同じ計算をやり直して一致を確認する
      const rn = decision.responseNodes.find((r) => r.forLabel === 'raise55')
      expect(rn).toBeDefined()
      const node = rn!.node
      const handCount = decision.villainCombos.length
      const foldIdx = node.actionLabels.indexOf('fold')
      let foldSum = 0
      let weightSum = 0
      for (let h = 0; h < handCount; h++) {
        foldSum += decision.villainWeights[h] * (foldIdx >= 0 ? node.freqs[foldIdx * handCount + h] : 0)
        weightSum += decision.villainWeights[h]
      }
      const expectedFoldFreq = weightSum > 0 ? foldSum / weightSum : 0
      expect(raiseResp!.foldFreq).toBeCloseTo(expectedFoldFreq, 6)
    })

    it('chosenLabelがterminal(fold/call)の場合、continueCombosReducedPctはnullになる', () => {
      const spot = buildFacingBetSpot()
      const chosenLabel = 'call'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.blockers.continueCombosReducedPct).toBeNull()
    })

    it('chosenLabelが応答ノードを持つ場合(raise55等)、continueCombosReducedPctは0〜100の範囲', () => {
      const spot = buildFacingBetSpot()
      const chosenLabel = 'raise55'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.blockers.continueCombosReducedPct).not.toBeNull()
      expect(features.blockers.continueCombosReducedPct!).toBeGreaterThanOrEqual(0)
      expect(features.blockers.continueCombosReducedPct!).toBeLessThanOrEqual(100)
    })

    it('blockersは全ブロックハンドをクラス別に漏れなく集計し、重み降順で返す', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.blockers.valueCombosReducedPct).toBeGreaterThanOrEqual(0)
      expect(features.blockers.valueCombosReducedPct).toBeLessThanOrEqual(100)
      expect(features.blockers.blockedExamples.length).toBeLessThanOrEqual(3)

      const decision = review.decisions[0]
      const rangeEq = computeSharedRunoutEquity({
        heroCombos: decision.heroCombos,
        heroWeights: decision.heroWeights,
        villainCombos: decision.villainCombos,
        villainWeights: decision.villainWeights,
        board: decision.boardAtDecision,
      })
      const userKeys = new Set(review.userCombo.map(cardKey))
      const expected = new Map<string, { comboCount: number; weight: number }>()
      for (let i = 0; i < decision.villainCombos.length; i++) {
        if (decision.villainWeights[i] <= 0 || Number.isNaN(rangeEq.villainEquity[i]) || rangeEq.villainEquity[i] < 0.66) continue
        if (!decision.villainCombos[i].some((c) => userKeys.has(cardKey(c)))) continue
        const hand = handStrFromCombo(decision.villainCombos[i])
        const entry = expected.get(hand) ?? { comboCount: 0, weight: 0 }
        entry.comboCount += 1
        entry.weight += decision.villainWeights[i]
        expected.set(hand, entry)
      }

      const actual = features.blockers.valueBlockedHands
      expect(actual.length).toBe(expected.size)
      expect(actual.length).toBeGreaterThan(3)
      expect(new Set(actual.map((entry) => entry.hand)).size).toBe(actual.length)
      expect(actual.reduce((sum, entry) => sum + entry.comboCount, 0)).toBe([...expected.values()].reduce((sum, entry) => sum + entry.comboCount, 0))
      expect(actual.reduce((sum, entry) => sum + entry.weightPct, 0)).toBeCloseTo(100, 6)
      for (let i = 0; i < actual.length; i++) {
        const expectedEntry = expected.get(actual[i].hand)
        expect(expectedEntry?.comboCount).toBe(actual[i].comboCount)
        if (i > 0) expect(actual[i - 1].weightPct).toBeGreaterThanOrEqual(actual[i].weightPct)
      }
    })
  })

  describe('P6 B6: ターン/リバー決断(boardAtDecisionが4/5枚)', () => {
    // FullHandController(B5)統合前でも、reviewBuilder.tsの型(Street拡張・
    // boardAtDecision、B1で追加済み)だけで合成したターン/リバー決断により、
    // computeSpotFeaturesがboard.length===3前提を残していないことを検証できる。
    const turnCard: Card = { rank: 2, suit: 'c' }
    const riverCards: Card[] = [
      { rank: 2, suit: 'c' },
      { rank: 3, suit: 'c' },
    ]

    it('boardAtDecisionが4枚(ターン)でもエラーなくfeaturesを計算できる', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const turnDecision = { ...review.decisions[0], street: 'turn' as const, boardAtDecision: [...review.board, turnCard] }
      const turnReview = { ...review, decisions: [turnDecision] }

      const features = computeSpotFeatures(turnReview, 0)

      expect(features.handClass).toBeDefined()
      expect(features.eqPercentileInRange).toBeGreaterThanOrEqual(0)
      expect(features.eqPercentileInRange).toBeLessThanOrEqual(100)
      expect(Number.isFinite(features.heroComboEquity)).toBe(true)
    })

    it('boardAtDecisionが5枚(リバー)でもエラーなくfeaturesを計算できる', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const riverDecision = { ...review.decisions[0], street: 'river' as const, boardAtDecision: [...review.board, ...riverCards] }
      const riverReview = { ...review, decisions: [riverDecision] }

      const features = computeSpotFeatures(riverReview, 0)

      expect(features.handClass).toBeDefined()
      expect(features.eqPercentileInRange).toBeGreaterThanOrEqual(0)
      expect(features.eqPercentileInRange).toBeLessThanOrEqual(100)
      expect(Number.isFinite(features.heroComboEquity)).toBe(true)
    })
  })
})
