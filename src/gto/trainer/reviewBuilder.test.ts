/// <reference types="node" />
// P5 Step B1: reviewBuilder.tsのテスト。実.binフィクスチャで統合的に検証する。
//
// import.meta.url経由のURL構築は既知の環境問題(grading.test.tsで判明、原因未特定)が
// あるため使わず、process.cwd()基準のパス解決を使う(grading.test.ts/store.test.tsと同じ
// パターン)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildReview,
  initialWeightsInSolutionOrder,
  weightsAtNode,
  handStrFromCombo,
} from './reviewBuilder'
import { createSpot, applyUserAction } from './gameFlow'
import { updateRangeWeights } from './rangeTracker'
import { actionLabelsWithAmounts } from './actionMath'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { buildStreetTree } from '../tree/actionTree'
import { cardKey } from '../../engine/deck'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

describe('reviewBuilder (実.binフィクスチャによる統合テスト)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flop = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flop) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', FLOP_STR + '.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  describe('initialWeightsInSolutionOrder', () => {
    it('解コンボ順序に整列し、合計1に正規化され、全て非負', () => {
      // raiser=BTN=IP(BTNはpostflopでIP)。scenario.raiser.rangeId="rfi_btn"をsolution.ipCombosに対応させる。
      const weights = initialWeightsInSolutionOrder(scenario.raiser.rangeId, solution.flop, solution.ipCombos)
      expect(weights.length).toBe(solution.ipCombos.length)
      const total = weights.reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1, 6)
      expect(weights.every((w) => w >= 0)).toBe(true)
      expect(weights.some((w) => w > 0)).toBe(true)
    })

    it('未知のrangeIdはエラーを投げる(getRangeの既存挙動を継承)', () => {
      expect(() => initialWeightsInSolutionOrder('not_a_real_range', solution.flop, solution.ipCombos)).toThrow()
    })
  })

  describe('weightsAtNode', () => {
    it('ルート直後(OOPのcheck後)のノードでは、OOP重みがcheckのfreqで再重み付けされ、IP重みは初期のまま', () => {
      const root = solution.nodes.get('')
      if (!root) throw new Error('root node missing in fixture')
      expect(root.actionLabels[0]).toBe('check')

      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))

      // oopIsRaiser=false(BTN raiserはOOPではない)なのでoopRangeId=defender.rangeId
      const initialOop = initialWeightsInSolutionOrder(scenario.defender.rangeId, solution.flop, solution.oopCombos)
      const initialIp = initialWeightsInSolutionOrder(scenario.raiser.rangeId, solution.flop, solution.ipCombos)
      const handCount = solution.oopCombos.length
      const checkFreqs: number[] = []
      for (let h = 0; h < handCount; h++) checkFreqs.push(root.freqs[0 * handCount + h])
      const expectedOop = updateRangeWeights(initialOop, checkFreqs)

      const { oopWeights, ipWeights } = weightsAtNode(spot, 'check')
      expect(oopWeights).toEqual(expectedOop)
      expect(ipWeights).toEqual(initialIp)
    })

    it('ルートノード(履歴なし)では初期レンジ重みがそのまま返る', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const initialOop = initialWeightsInSolutionOrder(scenario.defender.rangeId, solution.flop, solution.oopCombos)
      const initialIp = initialWeightsInSolutionOrder(scenario.raiser.rangeId, solution.flop, solution.ipCombos)
      const { oopWeights, ipWeights } = weightsAtNode(spot, '')
      expect(oopWeights).toEqual(initialOop)
      expect(ipWeights).toEqual(initialIp)
    })
  })

  describe('buildReview', () => {
    it('decisions.length===1で、ルートノードでは全アクションに応答ノードが存在する(fold/コール締めが起きない)', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)

      expect(review.decisions.length).toBe(1)
      const decision = review.decisions[0]
      expect(decision.responseNodes.length).toBe(spot.decodedNode.actionLabels.length)
      for (const r of decision.responseNodes) {
        expect(solution.nodes.has(r.nodeId)).toBe(true)
      }
      expect(review.history.length).toBeGreaterThan(0)
      expect(review.history[review.history.length - 1].isUserDecision).toBe(true)
      expect(review.history[review.history.length - 1].decisionIndex).toBe(0)
    })

    it('facing-betノードではfold/callの応答ノードが除外される(共にterminalのため)', () => {
      // このフロップ(AsQsJs)はOOPのcheck頻度が全コンボ平均99.8%・最大でも非check
      // 7.8%(BTNの範囲有利が非常に強いテクスチャ)で、createSpotの乱数サンプリングで
      // facing-betスポットを引き当てるのは現実的でない(数千回試行しても見つからない
      // ことを実測で確認済み)。決断ノードは配られたコンボに関わらず抽象木の到達可能な
      // 位置ごとに解データへ存在するため、'bet33'を経由するパスを直接指定して
      // facing-betのSpotStateを組み立てる(値は固定・決定論的)。
      const tree = buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 })
      if (tree.kind !== 'decision') throw new Error('root node is not a decision node')
      const bet33Idx = tree.actionLabels.indexOf('bet33')
      const facingNode = tree.children[bet33Idx]
      if (facingNode.kind !== 'decision') throw new Error('facing node is not a decision node')
      const facingDecoded = solution.nodes.get('bet33')
      if (!facingDecoded) throw new Error('solution has no node for path "bet33"')
      expect(facingDecoded.actionLabels).toContain('fold')
      expect(facingDecoded.actionLabels).toContain('call')

      const userCombo = solution.ipCombos[0]
      const userKeys = new Set(userCombo.map(cardKey))
      const botCombo = solution.oopCombos.find((c) => !c.some((card) => userKeys.has(cardKey(card))))
      if (!botCombo) throw new Error('no non-colliding OOP combo found for test fixture')

      const facingBetSpot = {
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

      const chosenLabel = 'call'
      const grading = applyUserAction(facingBetSpot, chosenLabel)
      const review = buildReview(facingBetSpot, grading, chosenLabel)
      const decision = review.decisions[0]
      const responseLabels = decision.responseNodes.map((r) => r.forLabel)

      expect(responseLabels).not.toContain('fold')
      expect(responseLabels).not.toContain('call')
      expect(responseLabels.length).toBeLessThan(facingBetSpot.decodedNode.actionLabels.length)
    })

    it('heroCombos/villainCombosはuserSeatに応じてOOP/IPの解コンボ表そのものを参照する', () => {
      const spotOop = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const gradingOop = applyUserAction(spotOop, spotOop.decodedNode.actionLabels[0])
      const reviewOop = buildReview(spotOop, gradingOop, spotOop.decodedNode.actionLabels[0])
      expect(reviewOop.decisions[0].heroCombos).toBe(solution.oopCombos)
      expect(reviewOop.decisions[0].villainCombos).toBe(solution.ipCombos)

      const spotIp = createSpot(scenario, flop, solution, 1, fixedRng([0.1, 0.1]))
      const gradingIp = applyUserAction(spotIp, spotIp.decodedNode.actionLabels[0])
      const reviewIp = buildReview(spotIp, gradingIp, spotIp.decodedNode.actionLabels[0])
      expect(reviewIp.decisions[0].heroCombos).toBe(solution.ipCombos)
      expect(reviewIp.decisions[0].villainCombos).toBe(solution.oopCombos)
    })
  })
})

describe('handStrFromCombo', () => {
  it('ペアはサフィックスなし', () => {
    expect(
      handStrFromCombo([
        { rank: 12, suit: 's' },
        { rank: 12, suit: 'd' },
      ]),
    ).toBe('QQ')
  })

  it('スーテッドは高ランク→低ランク→sの順', () => {
    expect(
      handStrFromCombo([
        { rank: 13, suit: 'h' },
        { rank: 14, suit: 'h' },
      ]),
    ).toBe('AKs')
  })

  it('オフスーツは高ランク→低ランク→oの順', () => {
    expect(
      handStrFromCombo([
        { rank: 14, suit: 'c' },
        { rank: 13, suit: 'd' },
      ]),
    ).toBe('AKo')
  })

  it('T以下の数字ランクも正しく変換される', () => {
    expect(
      handStrFromCombo([
        { rank: 10, suit: 'c' },
        { rank: 9, suit: 'd' },
      ]),
    ).toBe('T9o')
  })
})
