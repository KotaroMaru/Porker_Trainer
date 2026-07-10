// P5 Step B3: 「なぜ」解説カード(templates.ts)が使う特徴量を、1決断ぶんまとめて計算する。
// レンジ対レンジのエクイティはrangeEquity.computeSharedRunoutEquityに一元化し、
// ここでは「そのエクイティをどう解釈するか(パーセンタイル・優位判定・ブロッカー
// 減少率・MDF等)」に専念する。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { cardKey } from '../../engine/deck'
import { classifyHandStrength, type HandStrength } from '../../advisor/postflop'
import { classifyDraws } from '../../analysis/outs'
import { requiredEquity } from '../../analysis/potOdds'
import { computeSharedRunoutEquity } from './rangeEquity'
import { updateRangeWeights } from '../trainer/rangeTracker'
import { buildComboIndexMapFromCombos, lookupComboIndex } from '../trainer/comboIndex'
import { handStrFromCombo, type ReviewData, type ReviewDecision } from '../trainer/reviewBuilder'
import type { DecodedNode } from '../loader/binaryFormat'

export const HAND_CLASS_JA: Record<HandStrength, string> = {
  MONSTER: 'モンスター(フルハウス以上)',
  STRONG_MADE: '強い完成手(フラッシュ/ストレート/トリップス/ツーペア)',
  MIDDLE: 'ミドル(トップペア以上のワンペア)',
  WEAK_PAIR: '弱いペア',
  STRONG_DRAW: '強いドロー(フラッシュ/オープンエンド)',
  WEAK_DRAW: '弱いドロー(ガットショット)',
  AIR: 'エア(ショーダウン価値なし)',
}

export type NodeContext = { kind: 'root' } | { kind: 'facingBet'; betAmountBb: number; potBeforeCallBb: number }

export interface ActionResponseSummary {
  forLabel: string
  /** true: fold/コール締め等でこのアクションの先に相手の決断ノードが無い(応答なし)。 */
  terminal: boolean
  /** villain加重の、このアクションに対する相手の応答内訳(fold/call/raise等)。terminalなら空配列。 */
  breakdown: { label: string; freq: number }[]
  foldFreq: number
  /**
   * このアクションを選んだ場合の、相手の継続レンジ(fold以外に再重み付けした分布)に対する
   * 実手札のエクイティ。計算コストの都合上、chosenLabel/bestLabelの2アクションのみ計算する
   * (他はnull。templates.tsが実際に使うのはこの2つのみのため)。
   */
  heroEquityVsContinueRange: number | null
}

export interface EquityBucket {
  lo: number
  hi: number
  heroPct: number
  villainPct: number
}

export interface SpotFeatures {
  nodeContext: NodeContext
  handClass: HandStrength
  draws: ReturnType<typeof classifyDraws>
  heroComboEquity: number
  /** 0-100。自分のレンジ内で加重した実手札のエクイティ順位(高いほど強い側)。 */
  eqPercentileInRange: number
  rangeAdvantage: { heroAvg: number; villainAvg: number; verdictJa: string }
  /** EQ0.80以上を「ナッツ級」とみなした、両者レンジ内の加重割合(%)。 */
  nutsAdvantage: { heroTopPct: number; villainTopPct: number; verdictJa: string }
  equityBuckets: EquityBucket[]
  responses: ActionResponseSummary[]
  blockers: {
    valueCombosReducedPct: number
    continueCombosReducedPct: number | null
    blockedExamples: string[]
  }
  mdf: number | null
  potOddsRequiredEq: number | null
  sprBucket: { spr: number; labelJa: string }
  sameClass: { classJa: string; comboCount: number; actionMix: { label: string; freq: number }[] }
}

const NUTS_EQUITY_THRESHOLD = 0.8
const VALUE_EQUITY_THRESHOLD = 0.66
const ADVANTAGE_TOLERANCE = 0.03

function advantageVerdict(heroValue: number, villainValue: number, adjLabel: string): string {
  if (heroValue > villainValue + ADVANTAGE_TOLERANCE) return `${adjLabel}優位`
  if (villainValue > heroValue + ADVANTAGE_TOLERANCE) return `${adjLabel}劣位`
  return '互角'
}

function weightedPercentile(equities: Float64Array, weights: readonly number[], target: number): number {
  let below = 0
  let equal = 0
  let total = 0
  for (let i = 0; i < equities.length; i++) {
    if (weights[i] <= 0 || Number.isNaN(equities[i])) continue
    total += weights[i]
    if (equities[i] < target) below += weights[i]
    else if (equities[i] === target) equal += weights[i]
  }
  return total > 0 ? ((below + equal * 0.5) / total) * 100 : NaN
}

function weightedTopSharePct(equities: Float64Array, weights: readonly number[], threshold: number): number {
  let top = 0
  let total = 0
  for (let i = 0; i < equities.length; i++) {
    if (weights[i] <= 0 || Number.isNaN(equities[i])) continue
    total += weights[i]
    if (equities[i] >= threshold) top += weights[i]
  }
  return total > 0 ? (top / total) * 100 : 0
}

function buildEquityBuckets(heroEquity: Float64Array, heroWeights: readonly number[], villainEquity: Float64Array, villainWeights: readonly number[]): EquityBucket[] {
  const heroBuckets = new Array(10).fill(0)
  let heroTotal = 0
  for (let i = 0; i < heroEquity.length; i++) {
    if (heroWeights[i] <= 0 || Number.isNaN(heroEquity[i])) continue
    heroTotal += heroWeights[i]
    heroBuckets[Math.min(9, Math.floor(heroEquity[i] * 10))] += heroWeights[i]
  }
  const villainBuckets = new Array(10).fill(0)
  let villainTotal = 0
  for (let i = 0; i < villainEquity.length; i++) {
    if (villainWeights[i] <= 0 || Number.isNaN(villainEquity[i])) continue
    villainTotal += villainWeights[i]
    villainBuckets[Math.min(9, Math.floor(villainEquity[i] * 10))] += villainWeights[i]
  }
  return heroBuckets.map((_, b) => ({
    lo: b * 10,
    hi: (b + 1) * 10,
    heroPct: heroTotal > 0 ? (heroBuckets[b] / heroTotal) * 100 : 0,
    villainPct: villainTotal > 0 ? (villainBuckets[b] / villainTotal) * 100 : 0,
  }))
}

function computeNodeContext(decision: ReviewDecision): NodeContext {
  const foldEntry = decision.actionsWithAmounts.find((a) => a.label === 'fold')
  if (!foldEntry) return { kind: 'root' }
  const call = decision.actionsWithAmounts.find((a) => a.label === 'call')
  const betAmountBb = call?.amountBb ?? 0
  return { kind: 'facingBet', betAmountBb, potBeforeCallBb: decision.potBbAtDecision }
}

/** 応答ノードのvillain加重アクション内訳を求める(相手の実際のコンボ分布で重み付けした頻度)。 */
function computeResponseBreakdown(decision: ReviewDecision, node: DecodedNode): { label: string; freq: number }[] {
  const handCount = decision.villainCombos.length
  const weightSum = decision.villainWeights.reduce((a, b) => a + b, 0)
  return node.actionLabels.map((label, a) => {
    let s = 0
    for (let h = 0; h < handCount; h++) s += decision.villainWeights[h] * node.freqs[a * handCount + h]
    return { label, freq: weightSum > 0 ? s / weightSum : 0 }
  })
}

function computeResponses(review: ReviewData, decision: ReviewDecision, userCombo: Combo): ActionResponseSummary[] {
  const bestLabel = decision.grading.bestLabel
  const chosenLabel = decision.chosenLabel
  const handCount = decision.villainCombos.length

  return decision.decodedNode.actionLabels.map((label) => {
    const rn = decision.responseNodes.find((r) => r.forLabel === label)
    if (!rn) {
      return { forLabel: label, terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null }
    }
    const node = rn.node
    const breakdown = computeResponseBreakdown(decision, node)
    const foldFreq = breakdown.find((b) => b.label === 'fold')?.freq ?? 0

    let heroEquityVsContinueRange: number | null = null
    if (label === chosenLabel || label === bestLabel) {
      const foldIdx = node.actionLabels.indexOf('fold')
      const nonFoldFreqPerCombo: number[] = []
      for (let h = 0; h < handCount; h++) {
        const foldF = foldIdx >= 0 ? node.freqs[foldIdx * handCount + h] : 0
        nonFoldFreqPerCombo.push(1 - foldF)
      }
      const continueWeights = updateRangeWeights([...decision.villainWeights], nonFoldFreqPerCombo)
      const eqResult = computeSharedRunoutEquity({
        heroCombos: [userCombo],
        heroWeights: [1],
        villainCombos: decision.villainCombos,
        villainWeights: continueWeights,
        board: review.board,
      })
      heroEquityVsContinueRange = eqResult.heroEquity[0]
    }

    return { forLabel: label, terminal: false, breakdown, foldFreq, heroEquityVsContinueRange }
  })
}

function computeBlockedValuePct(villainCombos: readonly Combo[], weights: readonly number[], villainEquity: Float64Array, userCombo: Combo, threshold: number): { pct: number; blockedExamples: string[] } {
  const userKeys = new Set(userCombo.map(cardKey))
  let total = 0
  let blocked = 0
  const examples: { combo: Combo; weight: number }[] = []
  for (let i = 0; i < villainCombos.length; i++) {
    if (weights[i] <= 0 || Number.isNaN(villainEquity[i]) || villainEquity[i] < threshold) continue
    total += weights[i]
    const collides = villainCombos[i].some((c) => userKeys.has(cardKey(c)))
    if (collides) {
      blocked += weights[i]
      examples.push({ combo: villainCombos[i], weight: weights[i] })
    }
  }
  examples.sort((a, b) => b.weight - a.weight)
  return {
    pct: total > 0 ? (blocked / total) * 100 : 0,
    blockedExamples: examples.slice(0, 3).map((e) => handStrFromCombo(e.combo)),
  }
}

const SPR_LOW = 3
const SPR_HIGH = 6

function sprLabel(spr: number): string {
  if (spr < SPR_LOW) return `低SPR(<${SPR_LOW})`
  if (spr <= SPR_HIGH) return `中SPR(${SPR_LOW}-${SPR_HIGH})`
  return `高SPR(>${SPR_HIGH})`
}

function computeSameClass(decision: ReviewDecision, board: Card[], handClass: HandStrength): SpotFeatures['sameClass'] {
  const handCount = decision.heroCombos.length
  const actionSum = new Array(decision.decodedNode.actionLabels.length).fill(0)
  let totalWeight = 0
  let comboCount = 0
  for (let h = 0; h < handCount; h++) {
    if (decision.heroWeights[h] <= 0) continue
    const combo = decision.heroCombos[h]
    if (classifyHandStrength(combo, board) !== handClass) continue
    comboCount++
    totalWeight += decision.heroWeights[h]
    for (let a = 0; a < actionSum.length; a++) {
      actionSum[a] += decision.heroWeights[h] * decision.decodedNode.freqs[a * handCount + h]
    }
  }
  const actionMix = decision.decodedNode.actionLabels.map((label, a) => ({
    label,
    freq: totalWeight > 0 ? actionSum[a] / totalWeight : 0,
  }))
  return { classJa: HAND_CLASS_JA[handClass], comboCount, actionMix }
}

export function computeSpotFeatures(review: ReviewData, decisionIdx: number): SpotFeatures {
  const decision = review.decisions[decisionIdx]
  if (!decision) throw new Error(`computeSpotFeatures: no decision at index ${decisionIdx}`)
  const userCombo = review.userCombo
  const board = review.board

  const handClass = classifyHandStrength(userCombo, board)
  const draws = classifyDraws(userCombo, board)

  const rangeEq = computeSharedRunoutEquity({
    heroCombos: decision.heroCombos,
    heroWeights: decision.heroWeights,
    villainCombos: decision.villainCombos,
    villainWeights: decision.villainWeights,
    board,
  })

  const heroIdx = lookupComboIndex(buildComboIndexMapFromCombos(decision.heroCombos), userCombo)
  const heroComboEquity = rangeEq.heroEquity[heroIdx]
  const eqPercentileInRange = weightedPercentile(rangeEq.heroEquity, decision.heroWeights, heroComboEquity)

  const rangeAdvantage = {
    heroAvg: rangeEq.heroAvgEquity,
    villainAvg: rangeEq.villainAvgEquity,
    verdictJa: advantageVerdict(rangeEq.heroAvgEquity, rangeEq.villainAvgEquity, 'レンジ'),
  }

  const heroTopPct = weightedTopSharePct(rangeEq.heroEquity, decision.heroWeights, NUTS_EQUITY_THRESHOLD)
  const villainTopPct = weightedTopSharePct(rangeEq.villainEquity, decision.villainWeights, NUTS_EQUITY_THRESHOLD)
  const nutsAdvantage = {
    heroTopPct,
    villainTopPct,
    verdictJa: advantageVerdict(heroTopPct, villainTopPct, 'ナッツ'),
  }

  const equityBuckets = buildEquityBuckets(rangeEq.heroEquity, decision.heroWeights, rangeEq.villainEquity, decision.villainWeights)

  const responses = computeResponses(review, decision, userCombo)

  const nodeContext = computeNodeContext(decision)

  const { pct: valueCombosReducedPct, blockedExamples } = computeBlockedValuePct(
    decision.villainCombos,
    decision.villainWeights,
    rangeEq.villainEquity,
    userCombo,
    VALUE_EQUITY_THRESHOLD,
  )

  let continueCombosReducedPct: number | null = null
  if (nodeContext.kind === 'facingBet') {
    const chosenResponse = responses.find((r) => r.forLabel === decision.chosenLabel)
    if (chosenResponse && !chosenResponse.terminal) {
      const rn = decision.responseNodes.find((r) => r.forLabel === decision.chosenLabel)
      if (rn) {
        const foldIdx = rn.node.actionLabels.indexOf('fold')
        const handCount = decision.villainCombos.length
        const nonFoldFreqPerCombo: number[] = []
        for (let h = 0; h < handCount; h++) {
          const foldF = foldIdx >= 0 ? rn.node.freqs[foldIdx * handCount + h] : 0
          nonFoldFreqPerCombo.push(1 - foldF)
        }
        const continueWeights = updateRangeWeights([...decision.villainWeights], nonFoldFreqPerCombo)
        continueCombosReducedPct = computeBlockedValuePct(decision.villainCombos, continueWeights, rangeEq.villainEquity, userCombo, VALUE_EQUITY_THRESHOLD).pct
      }
    }
  }

  let mdf: number | null = null
  let potOddsRequiredEq: number | null = null
  if (nodeContext.kind === 'facingBet' && nodeContext.betAmountBb > 0) {
    mdf = 1 - nodeContext.betAmountBb / decision.potBbAtDecision
    potOddsRequiredEq = requiredEquity(nodeContext.betAmountBb, decision.potBbAtDecision)
  }

  const spr = decision.potBbAtDecision > 0 ? decision.effectiveStackRemainingBb / decision.potBbAtDecision : Infinity
  const sprBucket = { spr, labelJa: sprLabel(spr) }

  const sameClass = computeSameClass(decision, board, handClass)

  return {
    nodeContext,
    handClass,
    draws,
    heroComboEquity,
    eqPercentileInRange,
    rangeAdvantage,
    nutsAdvantage,
    equityBuckets,
    responses,
    blockers: { valueCombosReducedPct, continueCombosReducedPct, blockedExamples },
    mdf,
    potOddsRequiredEq,
    sprBucket,
    sameClass,
  }
}
