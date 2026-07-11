// P5 Step B2: レンジ対レンジの「実質的な」エクイティ(現ボード強さだけでなく、
// 残りストリートのランアウトを考慮した値)を計算する。
//
// なぜ既存のhandEval.computeRangeVsRangeEquity(現ボード強さのみ)を使わないか:
// フロップのフラッシュドロー・ストレートドローが「エア」扱いになり、解説の数値
// (EQパーセンタイル・ブロッカー分析)が定性的に誤るため(製品の差別化点である
// 解説レイヤーの信頼性に直結する)。
// なぜper-combo Monte Carloを使わないか: レンジ全体(~200コンボ)を秒単位の
// 時間で計算する必要があり、かつコンボごとに独立乱数だと隣接コンボの順位が
// ノイズで前後してパーセンタイル表示が不安定になる。
//
// 採用方式: 共有・決定論的ストライド標本ランアウト。ボードを除いた残りデッキから
// 決定論的な順序で全ランアウト(フロップなら49枚からC(49,2)=1176通りのターン+
// リバー)を列挙し、runoutStride間隔で標本抽出する(乱数不使用=再現性あり)。
// 全コンボが同一のランアウト集合で評価されるため、パーセンタイル・分布・
// ブロッカー差分が相互に整合する。
//
// runoutStride省略時は「hero+villainの総コンボ数」から自動決定する(下記
// defaultRunoutStride)。当初computeSharedRunoutEquity設計時はevaluate()1回を
// 数μs級と見積もっていたが、実測ではjsdom環境で約15μs/回かかることが判明した
// (実データ: srp_btn_vs_bb・495+478コンボでstride=12=98ランアウトだと約1.4秒)。
// 固定stride=12では実際のソルバーレンジ規模(数百コンボ)で性能ガードを満たせない
// 一方、レンジが狭い(ブロッカー分析等で数十コンボ)場合は密なサンプリングでないと
// 精度(±0.02 pot目標)が out になる。総評価回数(≈ランアウト数×総コンボ数)を
// 一定予算に収めるようstrideを逆算することで、両条件を両立させる。

import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { createDeck, cardKey } from '../../engine/deck'
import { scoreComboOnBoard } from '../solver/handEval'

export interface RangeEquityInput {
  heroCombos: readonly Combo[]
  heroWeights: readonly number[]
  villainCombos: readonly Combo[]
  villainWeights: readonly number[]
  /** 3枚(フロップ)/4枚(ターン)/5枚(リバー、P6用)。5枚に達するまでの残りを標本ランアウトする(5枚なら残り0=現ボードのみ1回評価)。 */
  board: Card[]
  /** ランアウト標本間隔。省略時はdefaultRunoutStride()で総コンボ数から自動決定。テストでは1=全列挙。 */
  runoutStride?: number
}

export interface RangeEquityOutput {
  /** heroCombos順。重み0のコンボはNaN。 */
  heroEquity: Float64Array
  /** villainCombos順。重み0のコンボはNaN。 */
  villainEquity: Float64Array
  /** heroWeights加重平均(NaNコンボは除外)。 */
  heroAvgEquity: number
  /** villainWeights加重平均(NaNコンボは除外)。 */
  villainAvgEquity: number
}

/** 目標とする総evaluate()呼び出し回数(実測15μs/回 → 概ね300ms程度に収まる水準)。 */
const TARGET_EVALUATE_BUDGET = 20000

/**
 * hero+villainの総コンボ数から、目標評価回数に収まるようランアウト標本間隔を
 * 逆算する。レンジが小さいほど密に(精度優先)、大きいほど粗く(速度優先)なる。
 */
export function defaultRunoutStride(totalRunoutCount: number, comboCountSum: number): number {
  if (comboCountSum <= 0 || totalRunoutCount <= 0) return 1
  const idealRunouts = TARGET_EVALUATE_BUDGET / comboCountSum
  const stride = Math.round(totalRunoutCount / Math.max(idealRunouts, 1))
  return Math.max(1, stride)
}

/** score以上が現れる最初のインデックス(昇順ソート済み前提)。 */
function lowerBound(scores: number[], score: number): number {
  let lo = 0
  let hi = scores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (scores[mid] < score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** scoreより大きい値が現れる最初のインデックス(昇順ソート済み前提)。 */
function upperBound(scores: number[], score: number): number {
  let lo = 0
  let hi = scores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (scores[mid] <= score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 残りデッキから、必要枚数分のランアウト(カード配列)を決定論的な順序で全列挙する。
 * 0枚(リバー、残りカードなし)/1枚(ターン)/2枚(フロップ)に対応。0枚は「現ボードのみ」の
 * 空ランアウト1本を返す(乱数不使用で必ず唯一の"ランアウト"として選ばれる)。
 */
function enumerateRunouts(remainingDeck: Card[], size: 0 | 1 | 2): Card[][] {
  if (size === 0) return [[]]
  if (size === 1) return remainingDeck.map((c) => [c])
  const runouts: Card[][] = []
  for (let i = 0; i < remainingDeck.length; i++) {
    for (let j = i + 1; j < remainingDeck.length; j++) {
      runouts.push([remainingDeck[i], remainingDeck[j]])
    }
  }
  return runouts
}

interface ScoredCombo {
  idx: number
  score: number
  weight: number
  keys: [string, string]
}

interface ScoredPool {
  scores: number[]
  prefixWeight: Float64Array
  totalWeight: number
  cardToPositions: Map<string, number[]>
  entries: ScoredCombo[]
}

function buildScoredPool(combos: readonly Combo[], weights: readonly number[], runoutKeySet: Set<string>, boardCardKeys: string[]): ScoredPool {
  const entries: ScoredCombo[] = []
  for (let i = 0; i < combos.length; i++) {
    if (weights[i] <= 0) continue
    const combo = combos[i]
    const k0 = cardKey(combo[0])
    const k1 = cardKey(combo[1])
    if (runoutKeySet.has(k0) || runoutKeySet.has(k1)) continue
    entries.push({ idx: i, score: scoreComboOnBoard(combo, boardCardKeys), weight: weights[i], keys: [k0, k1] })
  }
  entries.sort((a, b) => a.score - b.score)

  const prefixWeight = new Float64Array(entries.length + 1)
  for (let i = 0; i < entries.length; i++) prefixWeight[i + 1] = prefixWeight[i] + entries[i].weight

  const cardToPositions = new Map<string, number[]>()
  entries.forEach((e, pos) => {
    for (const k of e.keys) {
      const arr = cardToPositions.get(k)
      if (arr) arr.push(pos)
      else cardToPositions.set(k, [pos])
    }
  })

  return { scores: entries.map((e) => e.score), prefixWeight, totalWeight: prefixWeight[entries.length], cardToPositions, entries }
}

/**
 * scanningPool(1ランアウトぶんスコア計算済みのコンボ集合)の各コンボについて、
 * targetPoolに対する勝ち/引き分け加重確率を求めてaccumに加算する。
 * scanningCombos側のスコアはscanningPool構築時に既に計算済みのものを再利用し、
 * scoreComboOnBoardを再度呼ばない(1ランアウトあたりのevaluate呼び出し回数を
 * heroCombos.length+villainCombos.lengthに抑える。hero/villain双方向を素朴に
 * 実装すると2倍のevaluate呼び出しが発生するため、この再利用が性能ガードの要)。
 *
 * ブロッキング補正(scanning側の2枚のカードいずれかを含むtargetPool内コンボを
 * 除外する)の重複排除は、エントリごとにSetを新規割り当てると実データ規模
 * (レンジ~500コンボ×98ランアウト)でGC負荷が支配的になるため、targetPoolと
 * 同じ長さのvisitedEpoch配列を1ランアウトにつき1回だけ確保し、単調増加する
 * epoch番号でエントリごとの「訪問済み」を使い捨てクリア不要で判定する
 * (2枚のカードキーの位置リストの和集合を取るのに1エントリあたりO(重複数)で済む)。
 */
function accumulatePoolAgainstPool(
  scanningPool: ScoredPool,
  targetPool: ScoredPool,
  winAccum: Float64Array,
  tieAccum: Float64Array,
  totalAccum: Float64Array,
  visitedEpoch: Int32Array,
): void {
  let epoch = 0
  for (const entry of scanningPool.entries) {
    epoch++
    const score = entry.score
    const loIdx = lowerBound(targetPool.scores, score)
    const upIdx = upperBound(targetPool.scores, score)
    let winW = targetPool.prefixWeight[loIdx]
    let tieW = targetPool.prefixWeight[upIdx] - targetPool.prefixWeight[loIdx]
    let totalW = targetPool.totalWeight

    for (const k of entry.keys) {
      const positions = targetPool.cardToPositions.get(k)
      if (!positions) continue
      for (const p of positions) {
        if (visitedEpoch[p] === epoch) continue // 同一ランアウト内でk0/k1双方に登場する稀なケースの二重減算を防ぐ
        visitedEpoch[p] = epoch
        const v = targetPool.entries[p]
        totalW -= v.weight
        if (v.score < score) winW -= v.weight
        else if (v.score === score) tieW -= v.weight
      }
    }

    if (totalW > 1e-12) {
      winAccum[entry.idx] += winW
      tieAccum[entry.idx] += tieW
      totalAccum[entry.idx] += totalW
    }
  }
}

export function computeSharedRunoutEquity(input: RangeEquityInput): RangeEquityOutput {
  const { heroCombos, heroWeights, villainCombos, villainWeights, board } = input
  if (heroCombos.length !== heroWeights.length) throw new Error('computeSharedRunoutEquity: heroCombos/heroWeights length mismatch')
  if (villainCombos.length !== villainWeights.length) throw new Error('computeSharedRunoutEquity: villainCombos/villainWeights length mismatch')

  const remainingToDraw = 5 - board.length
  if (remainingToDraw !== 0 && remainingToDraw !== 1 && remainingToDraw !== 2) {
    throw new Error(`computeSharedRunoutEquity: unsupported board length ${board.length} (expected 3, 4, or 5)`)
  }

  const boardKeys = new Set(board.map(cardKey))
  const remainingDeck = createDeck().filter((c) => !boardKeys.has(cardKey(c)))
  const allRunouts = enumerateRunouts(remainingDeck, remainingToDraw as 0 | 1 | 2)
  const runoutStride = input.runoutStride ?? defaultRunoutStride(allRunouts.length, heroCombos.length + villainCombos.length)
  const selectedRunouts = allRunouts.filter((_, i) => i % runoutStride === 0)

  const heroWin = new Float64Array(heroCombos.length)
  const heroTie = new Float64Array(heroCombos.length)
  const heroTotal = new Float64Array(heroCombos.length)
  const villainWin = new Float64Array(villainCombos.length)
  const villainTie = new Float64Array(villainCombos.length)
  const villainTotal = new Float64Array(villainCombos.length)

  for (const runout of selectedRunouts) {
    const runoutKeySet = new Set(runout.map(cardKey))
    const boardCardKeys = [...board.map(cardKey), ...runout.map(cardKey)]

    const villainPool = buildScoredPool(villainCombos, villainWeights, runoutKeySet, boardCardKeys)
    const heroPool = buildScoredPool(heroCombos, heroWeights, runoutKeySet, boardCardKeys)

    accumulatePoolAgainstPool(heroPool, villainPool, heroWin, heroTie, heroTotal, new Int32Array(villainPool.entries.length))
    accumulatePoolAgainstPool(villainPool, heroPool, villainWin, villainTie, villainTotal, new Int32Array(heroPool.entries.length))
  }

  const heroEquity = new Float64Array(heroCombos.length)
  let heroWeightedSum = 0
  let heroWeightTotal = 0
  for (let i = 0; i < heroCombos.length; i++) {
    if (heroWeights[i] <= 0 || heroTotal[i] <= 0) {
      heroEquity[i] = NaN
      continue
    }
    const eq = (heroWin[i] + heroTie[i] * 0.5) / heroTotal[i]
    heroEquity[i] = eq
    heroWeightedSum += eq * heroWeights[i]
    heroWeightTotal += heroWeights[i]
  }

  const villainEquity = new Float64Array(villainCombos.length)
  let villainWeightedSum = 0
  let villainWeightTotal = 0
  for (let i = 0; i < villainCombos.length; i++) {
    if (villainWeights[i] <= 0 || villainTotal[i] <= 0) {
      villainEquity[i] = NaN
      continue
    }
    const eq = (villainWin[i] + villainTie[i] * 0.5) / villainTotal[i]
    villainEquity[i] = eq
    villainWeightedSum += eq * villainWeights[i]
    villainWeightTotal += villainWeights[i]
  }

  return {
    heroEquity,
    villainEquity,
    heroAvgEquity: heroWeightTotal > 0 ? heroWeightedSum / heroWeightTotal : NaN,
    villainAvgEquity: villainWeightTotal > 0 ? villainWeightedSum / villainWeightTotal : NaN,
  }
}
