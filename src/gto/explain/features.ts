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

/**
 * P13 Phase B-2(あ): AIRクラス(HandStrength上はノーペアを一括りにする)は、実際には
 * A♠2♥ on K♥9♠3♦のようなハイカードにも「エア(ショーダウン価値なし)」と表示してしまう
 * バグがあった(ユーザー報告)。HandStrength型・classifyHandStrength()自体は旧アプリ
 * (ヨコサワモデル)が依存するため変更せず、表示ラベルだけをここで補正する。
 * 境界(ボード最高ランクと同ランク)はキッカー勝負にしかならずSDV無し側に含める。
 */
export type NoPairShowdownValue = 'highCard' | 'air'

export function classifyNoPairShowdownValue(combo: Combo, board: readonly Card[]): NoPairShowdownValue {
  const maxBoardRank = Math.max(...board.map((c) => c.rank))
  return combo.some((c) => c.rank > maxBoardRank) ? 'highCard' : 'air'
}

const NO_PAIR_SDV_LABEL_JA: Record<NoPairShowdownValue, string> = {
  highCard: 'ショーダウン価値のあるハイカード',
  air: 'エア(ショーダウン価値なし)',
}

/**
 * P13 Phase B-2(い): 「弱いペア」は、MDF・ブロッカーで守るブラフキャッチャー型と、
 * ドロー完成の期待値で評価すべきドロー付きペア型とで推奨理由が根本的に異なるため、
 * 表示ラベルを2分割する。判定はdraws(既存)を主信号とする。
 */
export type WeakPairSubtype = 'bluffCatcher' | 'drawPaired'

export function classifyWeakPairSubtype(draws: ReturnType<typeof classifyDraws>): WeakPairSubtype {
  return draws.hasFlushDraw || draws.hasOESD ? 'drawPaired' : 'bluffCatcher'
}

const WEAK_PAIR_SUBTYPE_LABEL_JA: Record<WeakPairSubtype, string> = {
  bluffCatcher: '弱いペア(ブラフキャッチャー型)',
  drawPaired: '弱いペア(ドロー付き)',
}

/**
 * features.handClassの表示ラベルを決める。AIR/WEAK_PAIRのみ細分化したラベルへ差し替え、
 * それ以外はHAND_CLASS_JAをそのまま使う。sameClass.classJa(同クラス平均頻度の説明に使う、
 * 細分化前の母集団全体の値)は意図的にこの関数を経由させない(既存テストの契約通り
 * HAND_CLASS_JA[handClass]と一致させる)。
 */
export function handClassLabelJa(handClass: HandStrength, noPairShowdownValue: NoPairShowdownValue | null, weakPairSubtype: WeakPairSubtype | null): string {
  if (handClass === 'AIR' && noPairShowdownValue !== null) return NO_PAIR_SDV_LABEL_JA[noPairShowdownValue]
  if (handClass === 'WEAK_PAIR' && weakPairSubtype !== null) return WEAK_PAIR_SUBTYPE_LABEL_JA[weakPairSubtype]
  return HAND_CLASS_JA[handClass]
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

/** ブロックされた相手レンジを、RangeHeatGridと同じハンドクラス表記で集計した値。 */
export interface BlockedHand {
  hand: string
  comboCount: number
  /** ブロックされた重みの合計に対する、このハンドクラスの構成比(0-100)。 */
  weightPct: number
}

export interface BoardTexture {
  /** ペア/トリップス等、ボード自体に重複ランクがあるか。 */
  paired: boolean
  /** 全同スート/同スートあり/全て異なるスート、の3区分。 */
  suitPattern: 'monotone' | 'twoTone' | 'rainbow'
  /** Q以上を含むハイ、最高ランク8-Jのミドル、7以下のロー。 */
  heightJa: 'ハイ' | 'ミドル' | 'ロー'
  /** 3つの異なるランクが4ランク幅以内に収まる(ホイールのAを1としても判定)か。 */
  connected: boolean
  /** テンプレートへそのまま渡せる、日本語の短い要約。 */
  summaryJa: string
}

export interface BetActionTarget {
  forLabel: string
  valueTargetHands: BlockedHand[]
  bluffTargetHands: BlockedHand[]
}

export interface BetTarget {
  chosen: BetActionTarget | null
  best: BetActionTarget | null
}

export interface SpotFeatures {
  nodeContext: NodeContext
  boardTexture: BoardTexture
  handClass: HandStrength
  /** handClass==='AIR'の場合のみ非null(P13 Phase B-2あ)。 */
  noPairShowdownValue: NoPairShowdownValue | null
  /** handClass==='WEAK_PAIR'の場合のみ非null(P13 Phase B-2い)。 */
  weakPairSubtype: WeakPairSubtype | null
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
    valueBlockedHands: BlockedHand[]
    continueBlockedHands: BlockedHand[] | null
  }
  /** chosen/bestの少なくとも一方にfoldを含む応答ノードがある場合のみ非null。 */
  betTarget: BetTarget | null
  mdf: number | null
  potOddsRequiredEq: number | null
  sprBucket: { spr: number; labelJa: string }
  sameClass: { classJa: string; comboCount: number; actionMix: { label: string; freq: number }[] }
}

const NUTS_EQUITY_THRESHOLD = 0.8
const VALUE_EQUITY_THRESHOLD = 0.66
const ADVANTAGE_TOLERANCE = 0.03
const VALUE_TARGET_EQUITY_THRESHOLD = 0.5

export function classifyBoardTexture(board: readonly Card[]): BoardTexture {
  if (board.length < 3 || board.length > 5) {
    throw new Error(`classifyBoardTexture: expected 3 to 5 cards, got ${board.length}`)
  }

  const rankCounts = new Map<number, number>()
  const suitCounts = new Map<Card['suit'], number>()
  for (const card of board) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1)
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }

  const paired = [...rankCounts.values()].some((count) => count >= 2)
  const maxSuitCount = Math.max(...suitCounts.values())
  const suitPattern: BoardTexture['suitPattern'] = maxSuitCount === board.length ? 'monotone' : maxSuitCount >= 2 ? 'twoTone' : 'rainbow'
  const maxRank = Math.max(...board.map((card) => card.rank))
  const heightJa: BoardTexture['heightJa'] = maxRank >= 12 ? 'ハイ' : maxRank >= 8 ? 'ミドル' : 'ロー'

  const uniqueRanks = [...rankCounts.keys()]
  const rankViews = [uniqueRanks, uniqueRanks.includes(14) ? uniqueRanks.map((rank) => (rank === 14 ? 1 : rank)) : uniqueRanks]
  const connected = rankViews.some((ranks) => {
    const sorted = [...ranks].sort((a, b) => a - b)
    for (let i = 0; i + 2 < sorted.length; i++) {
      if (sorted[i + 2] - sorted[i] <= 4) return true
    }
    return false
  })

  const suitPatternJa = suitPattern === 'monotone' ? 'モノトーン' : suitPattern === 'twoTone' ? 'ツートーン' : 'レインボー'
  const summaryJa = [paired ? 'ペアボード' : null, suitPatternJa, connected ? 'コネクテッド' : 'ドライ'].filter((part) => part !== null).join('・')

  return { paired, suitPattern, heightJa, connected, summaryJa }
}

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

function aggregateTargetHands(villainCombos: readonly Combo[], weights: readonly number[], eligible?: (index: number) => boolean): BlockedHand[] {
  const byHand = new Map<string, { comboCount: number; weight: number }>()
  let total = 0
  for (let i = 0; i < villainCombos.length; i++) {
    const weight = weights[i]
    if (weight <= 0 || !Number.isFinite(weight) || (eligible && !eligible(i))) continue
    const hand = handStrFromCombo(villainCombos[i])
    const entry = byHand.get(hand) ?? { comboCount: 0, weight: 0 }
    entry.comboCount += 1
    entry.weight += weight
    total += weight
    byHand.set(hand, entry)
  }
  return [...byHand.entries()]
    .map(([hand, entry]) => ({ hand, comboCount: entry.comboCount, weightPct: total > 0 ? (entry.weight / total) * 100 : 0 }))
    .sort((a, b) => b.weightPct - a.weightPct || a.hand.localeCompare(b.hand))
}

function computeResponses(decision: ReviewDecision, userCombo: Combo): { responses: ActionResponseSummary[]; betTargets: Map<string, BetActionTarget> } {
  const bestLabel = decision.grading.bestLabel
  const chosenLabel = decision.chosenLabel
  const handCount = decision.villainCombos.length
  const betTargets = new Map<string, BetActionTarget>()

  const responses = decision.decodedNode.actionLabels.map((label) => {
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
        board: decision.boardAtDecision,
      })
      heroEquityVsContinueRange = eqResult.heroEquity[0]

      // foldを持たない応答ノード(check→bet等)は、ベットへのfold/continue分布を
      // 定義できないためターゲット抽出の対象外にする。
      if (foldIdx >= 0) {
        const valueTargetHands = aggregateTargetHands(
          decision.villainCombos,
          continueWeights,
          (index) => !Number.isNaN(eqResult.villainEquity[index]) && eqResult.villainEquity[index] < VALUE_TARGET_EQUITY_THRESHOLD,
        )
        const foldWeights = decision.villainWeights.map((weight, index) => weight * node.freqs[foldIdx * handCount + index])
        const bluffTargetHands = aggregateTargetHands(decision.villainCombos, foldWeights)
        betTargets.set(label, { forLabel: label, valueTargetHands, bluffTargetHands })
      }
    }

    return { forLabel: label, terminal: false, breakdown, foldFreq, heroEquityVsContinueRange }
  })

  return { responses, betTargets }
}

function computeBlockedValuePct(
  villainCombos: readonly Combo[],
  weights: readonly number[],
  villainEquity: Float64Array,
  userCombo: Combo,
  threshold: number,
): { pct: number; blockedExamples: string[]; blockedHands: BlockedHand[] } {
  const userKeys = new Set(userCombo.map(cardKey))
  let total = 0
  let blocked = 0
  const byHand = new Map<string, { comboCount: number; weight: number }>()
  for (let i = 0; i < villainCombos.length; i++) {
    if (weights[i] <= 0 || Number.isNaN(villainEquity[i]) || villainEquity[i] < threshold) continue
    total += weights[i]
    const collides = villainCombos[i].some((c) => userKeys.has(cardKey(c)))
    if (collides) {
      blocked += weights[i]
      const hand = handStrFromCombo(villainCombos[i])
      const entry = byHand.get(hand) ?? { comboCount: 0, weight: 0 }
      entry.comboCount += 1
      entry.weight += weights[i]
      byHand.set(hand, entry)
    }
  }
  const blockedHands = [...byHand.entries()]
    .map(([hand, entry]) => ({ hand, comboCount: entry.comboCount, weightPct: blocked > 0 ? (entry.weight / blocked) * 100 : 0 }))
    .sort((a, b) => b.weightPct - a.weightPct || a.hand.localeCompare(b.hand))
  return {
    pct: total > 0 ? (blocked / total) * 100 : 0,
    // P13 Phase B-1: 以前はコンボ単位の例示(重複除去なし)をハンド表記へ変換していたため
    // 「AKo, AKo, AKs」のように同一ハンドが重複していた(ユーザー報告)。blockedHandsは
    // 既にハンド単位で集約・降順ソート済みなので、そこから作れば重複しない。
    blockedExamples: blockedHands.slice(0, 3).map((h) => h.hand),
    blockedHands,
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
  const board = decision.boardAtDecision
  const boardTexture = classifyBoardTexture(board)

  const handClass = classifyHandStrength(userCombo, board)
  const draws = classifyDraws(userCombo, board)
  const noPairShowdownValue = handClass === 'AIR' ? classifyNoPairShowdownValue(userCombo, board) : null
  const weakPairSubtype = handClass === 'WEAK_PAIR' ? classifyWeakPairSubtype(draws) : null

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

  const { responses, betTargets } = computeResponses(decision, userCombo)
  const chosenBetTarget = betTargets.get(decision.chosenLabel) ?? null
  const bestBetTarget = betTargets.get(decision.grading.bestLabel) ?? null
  const betTarget: BetTarget | null = chosenBetTarget || bestBetTarget ? { chosen: chosenBetTarget, best: bestBetTarget } : null

  const nodeContext = computeNodeContext(decision)

  const { pct: valueCombosReducedPct, blockedExamples, blockedHands: valueBlockedHands } = computeBlockedValuePct(
    decision.villainCombos,
    decision.villainWeights,
    rangeEq.villainEquity,
    userCombo,
    VALUE_EQUITY_THRESHOLD,
  )

  let continueCombosReducedPct: number | null = null
  let continueBlockedHands: BlockedHand[] | null = null
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
        const continueBlockers = computeBlockedValuePct(decision.villainCombos, continueWeights, rangeEq.villainEquity, userCombo, VALUE_EQUITY_THRESHOLD)
        continueCombosReducedPct = continueBlockers.pct
        continueBlockedHands = continueBlockers.blockedHands
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
    boardTexture,
    handClass,
    noPairShowdownValue,
    weakPairSubtype,
    draws,
    heroComboEquity,
    eqPercentileInRange,
    rangeAdvantage,
    nutsAdvantage,
    equityBuckets,
    responses,
    blockers: { valueCombosReducedPct, continueCombosReducedPct, blockedExamples, valueBlockedHands, continueBlockedHands },
    betTarget,
    mdf,
    potOddsRequiredEq,
    sprBucket,
    sameClass,
  }
}
