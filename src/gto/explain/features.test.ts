/// <reference types="node" />
// P5 Step B3: features.tsのテスト。実.binフィクスチャで統合的に検証する
// (import.meta.url経由のURL構築は既知の環境問題があるためprocess.cwd()基準で読む)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyBackdoors, classifyBoardTexture, classifySdvLevel, computeSpotFeatures, computeCurrentShowdown, computePrevStreetCheckedThrough, computeVillainCheckedToHero, classifyWeakPairSubtype, HAND_CLASS_JA } from './features'
import type { HistoryEntry } from '../trainer/reviewBuilder'
import { classifyDraws } from '../../analysis/outs'
import { computeSharedRunoutEquity } from './rangeEquity'
import { buildReview, handStrFromCombo } from '../trainer/reviewBuilder'
import { RANGE_TRACKER_EPSILON } from '../trainer/rangeTracker'
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
const NUMERIC_TOLERANCE_DIGITS = 6

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

describe('classifyBoardTexture', () => {
  it('ペアボード AsAd7c をレインボーかつドライなハイボードに分類する', () => {
    const texture = classifyBoardTexture([card(14, 's'), card(14, 'd'), card(7, 'c')])

    expect(texture).toEqual({
      paired: true,
      suitPattern: 'rainbow',
      heightJa: 'ハイ',
      connected: false,
      summaryJa: 'ペアボード・レインボー・ドライ',
    })
  })

  it('Ah7h2h をモノトーンかつドライなハイボードに分類する', () => {
    const texture = classifyBoardTexture([card(14, 'h'), card(7, 'h'), card(2, 'h')])

    expect(texture.paired).toBe(false)
    expect(texture.suitPattern).toBe('monotone')
    expect(texture.heightJa).toBe('ハイ')
    expect(texture.connected).toBe(false)
    expect(texture.summaryJa).toBe('モノトーン・ドライ')
  })

  it('9s8h7c をレインボーかつコネクテッドなミドルボードに分類する', () => {
    const texture = classifyBoardTexture([card(9, 's'), card(8, 'h'), card(7, 'c')])

    expect(texture).toEqual({
      paired: false,
      suitPattern: 'rainbow',
      heightJa: 'ミドル',
      connected: true,
      summaryJa: 'レインボー・コネクテッド',
    })
  })

  it('Aをロー側として扱い、5d3s2c を含むホイール形をコネクテッドと判定する', () => {
    const texture = classifyBoardTexture([card(14, 'c'), card(5, 'd'), card(3, 's'), card(2, 'c')])

    expect(texture.suitPattern).toBe('twoTone')
    expect(texture.connected).toBe(true)
  })

  it('7s5h2c をローかつドライに分類し、範囲外の枚数を拒否する', () => {
    const texture = classifyBoardTexture([card(7, 's'), card(5, 'h'), card(2, 'c')])

    expect(texture.heightJa).toBe('ロー')
    expect(texture.connected).toBe(false)
    expect(() => classifyBoardTexture([card(14, 's'), card(13, 'h')])).toThrow('expected 3 to 5 cards')
  })
})

describe('classifySdvLevel (P14 S1)', () => {
  it('実測で確定した40%/25%境界を含めて3段階に分類する', () => {
    expect(classifySdvLevel(40)).toBe('solid')
    expect(classifySdvLevel(39.9)).toBe('thin')
    expect(classifySdvLevel(25)).toBe('thin')
    expect(classifySdvLevel(24.9)).toBe('none')
  })
})

describe('classifyBackdoors (P14 S1)', () => {
  it('A♦3♦ on 7♥7♠K♦はナッツ・バックドアフラッシュだけを持つ', () => {
    const result = classifyBackdoors([card(14, 'd'), card(3, 'd')], [card(7, 'h'), card(7, 's'), card(13, 'd')])
    expect(result).toEqual({ flush: { has: true, isNut: true }, straight: { has: false, isWheel: false } })
  })

  it('8♣9♦ on T♠2♥3♣は非ホイールのバックドアストレートを持つ', () => {
    const result = classifyBackdoors([card(8, 'c'), card(9, 'd')], [card(10, 's'), card(2, 'h'), card(3, 'c')])
    expect(result.straight).toEqual({ has: true, isWheel: false })
  })

  it('A♠2♠ on 9♦4♥6♣はホイールのバックドアストレートを持つ', () => {
    const result = classifyBackdoors([card(14, 's'), card(2, 's')], [card(9, 'd'), card(4, 'h'), card(6, 'c')])
    expect(result.straight).toEqual({ has: true, isWheel: true })
  })

  it('フロップが3枚同スートでも手札がそのスートを持たなければバックドアフラッシュにしない', () => {
    const result = classifyBackdoors([card(14, 's'), card(2, 'd')], [card(13, 'h'), card(9, 'h'), card(4, 'h')])
    expect(result.flush).toEqual({ has: false, isNut: false })
  })

  it('ターン/リバーではバックドア候補を返さない', () => {
    const result = classifyBackdoors([card(14, 'd'), card(3, 'd')], [card(7, 'h'), card(7, 's'), card(13, 'd'), card(2, 'c')])
    expect(result).toEqual({ flush: { has: false, isNut: false }, straight: { has: false, isWheel: false } })
  })
})

describe('classifyWeakPairSubtype (P13 Phase B-2い)', () => {
  it('TT on K♥J♣3♣7♥(ドロー無し)を bluffCatcher に分類する', () => {
    const board = [card(13, 'h'), card(11, 'c'), card(3, 'c'), card(7, 'h')]
    const combo = [card(10, 's'), card(10, 'd')]
    const draws = classifyDraws(combo, board)
    expect(draws.hasFlushDraw).toBe(false)
    expect(draws.hasOESD).toBe(false)
    expect(classifyWeakPairSubtype(draws)).toBe('bluffCatcher')
  })

  it('ペア+フラッシュドローの手を drawPaired に分類する', () => {
    // ボードに既にハートが3枚(K♥9♥5♥)あるため、手札のハート1枚(4♥)で4枚に到達し
    // フラッシュドロー成立。9♠でボードの9とペアになる(9♥は既にボード側にあるため
    // ペア札自体をハートにはできない)。
    const board = [card(13, 'h'), card(9, 'h'), card(5, 'h')]
    const combo = [card(9, 's'), card(4, 'h')]
    const draws = classifyDraws(combo, board)
    expect(draws.hasFlushDraw).toBe(true)
    expect(classifyWeakPairSubtype(draws)).toBe('drawPaired')
  })
})

describe('computeCurrentShowdown (P13 Phase D-0-a)', () => {
  // ボードK♥Q♠2♦、ヒーローA♣A♥(オーバーペア)。全列挙で手計算した期待値と突き合わせる。
  const board = [card(13, 'h'), card(12, 's'), card(2, 'd')]
  const heroCombo: [Card, Card] = [card(14, 'c'), card(14, 'h')]

  it('win/tie/loseとtie=0.5加算、weight<=0の除外、ヒーローとのカード重複除外を全列挙で検証する', () => {
    const villainCombos: [Card, Card][] = [
      [card(13, 'd'), card(13, 'c')], // KK: セット、ヒーロー負け
      [card(12, 'd'), card(12, 'c')], // QQ: セット、ヒーロー負け
      [card(11, 'c'), card(10, 'd')], // JT: ハイカードK、ヒーロー勝ち(AA>ハイカード)
      [card(14, 'd'), card(14, 's')], // AA: 完全タイ(残りのA2枚)
      [card(9, 'c'), card(8, 'd')], // 重み0、集計から除外されるべき
      [card(14, 'c'), card(5, 'h')], // ヒーローのA♣と重複、除外されるべき
    ]
    const villainWeights = [1, 1, 1, 1, 0, 1]

    const result = computeCurrentShowdown(heroCombo, villainCombos, villainWeights, board)

    // 有効な母集団はKK/QQ/JT/AAの4コンボ(重み0とカード重複を除く)。
    // win=JT(1)、tie=AA(1)、lose=KK,QQ(2) → heroEquity=(1+1*0.5)/4=0.375、heroAheadPct=1/4*100=25。
    expect(result.heroEquity).toBeCloseTo(0.375, NUMERIC_TOLERANCE_DIGITS)
    expect(result.heroAheadPct).toBeCloseTo(25, NUMERIC_TOLERANCE_DIGITS)
  })

  it('全コンボがヒーローと重複/weight<=0の場合はNaNを返す(0除算にならない)', () => {
    const result = computeCurrentShowdown(heroCombo, [[card(14, 'd'), card(5, 'h')] as [Card, Card]], [0], board)
    expect(Number.isNaN(result.heroEquity)).toBe(true)
    expect(Number.isNaN(result.heroAheadPct)).toBe(true)
  })
})

describe('computePrevStreetCheckedThrough (P13 Phase D-0-c)', () => {
  function entry(street: HistoryEntry['street'], label: string): HistoryEntry {
    return { street, position: 'BB', label, isUserDecision: false }
  }

  it('flop決断は直前ストリートが存在しないためnull', () => {
    expect(computePrevStreetCheckedThrough([entry('flop', 'check')], 'flop')).toBeNull()
  })

  it('直前ストリート(flop)が全checkならtrue', () => {
    const history = [entry('flop', 'check'), entry('flop', 'check')]
    expect(computePrevStreetCheckedThrough(history, 'turn')).toBe(true)
  })

  it('直前ストリートにcheck以外が混じればfalse', () => {
    const history = [entry('flop', 'check'), entry('flop', 'bet33')]
    expect(computePrevStreetCheckedThrough(history, 'turn')).toBe(false)
  })

  it('直前ストリートの履歴が無ければnull(推測しない)', () => {
    expect(computePrevStreetCheckedThrough([entry('preflop', 'レイズ 2.5bb')], 'turn')).toBeNull()
  })
})

describe('computeVillainCheckedToHero (P14 S1)', () => {
  function entry(label: string, isUserDecision = false, decisionIndex?: number): HistoryEntry {
    return { street: 'flop', position: isUserDecision ? 'BTN' : 'CO', label, isUserDecision, decisionIndex }
  }

  it('同一ストリートで相手が直前にcheckしていればtrue', () => {
    expect(computeVillainCheckedToHero([entry('check'), entry('bet33', true, 0)], 0, 'flop')).toBe(true)
  })

  it('相手の直前行動がbetならfalse、先行履歴がなければnull', () => {
    expect(computeVillainCheckedToHero([entry('bet33'), entry('call', true, 0)], 0, 'flop')).toBe(false)
    expect(computeVillainCheckedToHero([entry('check', true, 0)], 0, 'flop')).toBeNull()
  })
})

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
      // P13 Phase D-0-c: ベットに直面していないのでbettorIsIpはnull、flop決断なので
      // 直前ストリートが存在せずflopCheckedThroughもnull。
      expect(features.streetStructure.bettorIsIp).toBeNull()
      expect(features.streetStructure.flopCheckedThrough).toBeNull()
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

    it('targetsは実コンボ対継続レンジの個別EQとfold頻度を事実名で集計する', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = 'bet33'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)
      const decision = review.decisions[0]
      const rn = decision.responseNodes.find((response) => response.forLabel === chosenLabel)
      expect(rn).toBeDefined()
      const foldIdx = rn!.node.actionLabels.indexOf('fold')
      expect(foldIdx).toBeGreaterThanOrEqual(0)

      const foldFreqs = decision.villainCombos.map((_, index) => rn!.node.freqs[foldIdx * decision.villainCombos.length + index])
      const unnormalizedContinue = decision.villainWeights.map((weight, index) => weight * Math.max(1 - foldFreqs[index], RANGE_TRACKER_EPSILON))
      const continueTotal = unnormalizedContinue.reduce((sum, weight) => sum + weight, 0)
      const continueWeights = unnormalizedContinue.map((weight) => weight / continueTotal)
      // 本体とは独立した呼び出しで、ヒーロー実コンボ視点の各villainコンボEQを照合する。
      // tieは0.5として扱われるため、value対象はvillainEquity < 0.5に限定する。
      const comboEq = computeSharedRunoutEquity({
        heroCombos: [review.userCombo],
        heroWeights: [1],
        villainCombos: decision.villainCombos,
        villainWeights: continueWeights,
        board: decision.boardAtDecision,
      })

      const expectedValue = new Map<string, { comboCount: number; weight: number }>()
      let expectedValueWeight = 0
      let blockedComboCount = 0
      const userKeys = new Set(review.userCombo.map(cardKey))
      for (let i = 0; i < decision.villainCombos.length; i++) {
        const collides = decision.villainCombos[i].some((comboCard) => userKeys.has(cardKey(comboCard)))
        if (collides && decision.villainWeights[i] > 0) {
          blockedComboCount++
          expect(Number.isNaN(comboEq.villainEquity[i])).toBe(true)
        }
        if (continueWeights[i] <= 0 || Number.isNaN(comboEq.villainEquity[i]) || comboEq.villainEquity[i] >= 0.5) continue
        const hand = handStrFromCombo(decision.villainCombos[i])
        const entry = expectedValue.get(hand) ?? { comboCount: 0, weight: 0 }
        entry.comboCount++
        entry.weight += continueWeights[i]
        expectedValueWeight += continueWeights[i]
        expectedValue.set(hand, entry)
      }
      expect(blockedComboCount).toBeGreaterThan(0)

      const expectedBluff = new Map<string, { comboCount: number; weight: number }>()
      let expectedBluffWeight = 0
      for (let i = 0; i < decision.villainCombos.length; i++) {
        const foldWeight = decision.villainWeights[i] * foldFreqs[i]
        if (foldWeight <= 0) continue
        const hand = handStrFromCombo(decision.villainCombos[i])
        const entry = expectedBluff.get(hand) ?? { comboCount: 0, weight: 0 }
        entry.comboCount++
        entry.weight += foldWeight
        expectedBluffWeight += foldWeight
        expectedBluff.set(hand, entry)
      }

      const target = features.targets?.chosen
      expect(target?.forLabel).toBe(chosenLabel)
      const valueTargets = target?.continueWeakHands ?? []
      const bluffTargets = target?.foldedHands ?? []
      expect(valueTargets.length).toBe(expectedValue.size)
      expect(bluffTargets.length).toBe(expectedBluff.size)
      expect(new Set(valueTargets.map((entry) => entry.hand)).size).toBe(valueTargets.length)
      expect(new Set(bluffTargets.map((entry) => entry.hand)).size).toBe(bluffTargets.length)
      expect(valueTargets.reduce((sum, entry) => sum + entry.weightPct, 0)).toBeCloseTo(100, NUMERIC_TOLERANCE_DIGITS)
      expect(bluffTargets.reduce((sum, entry) => sum + entry.weightPct, 0)).toBeCloseTo(100, NUMERIC_TOLERANCE_DIGITS)

      for (let i = 0; i < valueTargets.length; i++) {
        const actual = valueTargets[i]
        const expected = expectedValue.get(actual.hand)
        expect(expected).toBeDefined()
        expect(actual.comboCount).toBe(expected!.comboCount)
        expect(actual.weightPct).toBeCloseTo((expected!.weight / expectedValueWeight) * 100, NUMERIC_TOLERANCE_DIGITS)
        if (i > 0) expect(valueTargets[i - 1].weightPct).toBeGreaterThanOrEqual(actual.weightPct)
      }
      for (let i = 0; i < bluffTargets.length; i++) {
        const actual = bluffTargets[i]
        const expected = expectedBluff.get(actual.hand)
        expect(expected).toBeDefined()
        expect(actual.comboCount).toBe(expected!.comboCount)
        expect(actual.weightPct).toBeCloseTo((expected!.weight / expectedBluffWeight) * 100, NUMERIC_TOLERANCE_DIGITS)
        if (i > 0) expect(bluffTargets[i - 1].weightPct).toBeGreaterThanOrEqual(actual.weightPct)
      }
    })

    it('chosen/bestともfold応答を持たないcheckならtargetsはnull', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const grading = applyUserAction(spot, 'check')
      const review = buildReview(spot, { ...grading, bestLabel: 'check' }, 'check')
      const features = computeSpotFeatures(review, 0)

      expect(features.targets).toBeNull()
    })

    it('fold頻度が全コンボ0ならfoldedHandsは空配列になる', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = 'bet33'
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const decision = review.decisions[0]
      const responseNodes = decision.responseNodes.map((response) => {
        if (response.forLabel !== chosenLabel) return response
        const foldIdx = response.node.actionLabels.indexOf('fold')
        const freqs = new Float32Array(response.node.freqs)
        for (let i = 0; i < decision.villainCombos.length; i++) freqs[foldIdx * decision.villainCombos.length + i] = 0
        return { ...response, node: { ...response.node, freqs } }
      })
      const modifiedReview = { ...review, decisions: [{ ...decision, responseNodes }] }

      const features = computeSpotFeatures(modifiedReview, 0)

      expect(features.targets?.chosen?.foldedHands).toEqual([])
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
      // P13 Phase D-0-c: buildFacingBetSpot()はuserSeat=1(ヒーローIP)なので、
      // ヒーローに直面しているベットの主(villain)はOOP=bettorIsIpはfalse。
      expect(features.streetStructure.bettorIsIp).toBe(false)
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

    it('P13 Phase B-1回帰: blockedExamplesはハンド単位で重複しない(同一ハンドの複数コンボが混在する入力で確認)', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      // このテストが意味を持つには、少なくとも1ハンドが複数コンボでブロックされている必要がある
      // (でなければ重複バグの再現条件を満たさない)。
      expect(features.blockers.valueBlockedHands.some((h) => h.comboCount > 1)).toBe(true)

      const examples = features.blockers.blockedExamples
      expect(new Set(examples).size).toBe(examples.length)
      // 例示は「ハンド単位で集約・降順ソート済み」のblockedHands先頭と一致する(旧実装は
      // コンボ単位の未重複配列から作っていたため「AKo, AKo, AKs」のように重複していた)。
      expect(examples).toEqual(features.blockers.valueBlockedHands.slice(0, examples.length).map((h) => h.hand))
    })

    it('P13 Phase D-0-b: バリュー側とブラフ側は排他的なエクイティ帯を見るため、合計ブロック量が全体を超えない', () => {
      const spot = createSpot(scenario, flop, solution, 0, fixedRng([0.1]))
      const chosenLabel = spot.decodedNode.actionLabels[0]
      const grading = applyUserAction(spot, chosenLabel)
      const review = buildReview(spot, grading, chosenLabel)
      const features = computeSpotFeatures(review, 0)

      expect(features.blockers.bluffCombosReducedPct).toBeGreaterThanOrEqual(0)
      expect(features.blockers.bluffCombosReducedPct).toBeLessThanOrEqual(100)
      // ブラフ側の例示もハンド単位で重複しない(B-1と同じ不変条件)。
      const bluffHands = features.blockers.bluffBlockedHands.map((h) => h.hand)
      expect(new Set(bluffHands).size).toBe(bluffHands.length)

      // バリュー側(エクイティ>=0.66)とブラフ側(エクイティ<=0.34)は排他的なコンボ集合を見るため、
      // 両者が「ブロックした」と数えるコンボ(=ヒーローの手と重複するコンボ)同士も重複しない。
      const valueBlockedComboWeight = features.blockers.valueBlockedHands.reduce((s, h) => s + h.comboCount, 0)
      const bluffBlockedComboWeight = features.blockers.bluffBlockedHands.reduce((s, h) => s + h.comboCount, 0)
      const decision = review.decisions[0]
      const totalBlockedCombos = decision.villainCombos.filter((c) => c.some((card) => review.userCombo.some((u) => cardKey(u) === cardKey(card)))).length
      expect(valueBlockedComboWeight + bluffBlockedComboWeight).toBeLessThanOrEqual(totalBlockedCombos)
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
