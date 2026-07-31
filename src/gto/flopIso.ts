// P12 Phase B: 「入力フロップ → 収録済みフロップへのスート置換」を求める純関数群。
//
// 収録フロップ(FLOPS, 95件)は「盤面テクスチャ(モノトーン/ツートーン/レインボー等)ごとに
// 代表となる1つの具体的なスート表記」だけを持つ(スート回転した別表記は収録されていない)。
// ポーカーの戦略はスートそのものではなく「どのカードが同じスートか」という相対関係だけで
// 決まるため、入力フロップをスート置換して収録フロップと一致させられれば、同じ解析結果を
// 使い回せる(このファイルの`findIsomorphicStoredFlop`)。
//
// 数学的な要件(GTOドメイン最重要ルール適用): 置換の結果が「本当に同じ状況」であることを
// flopIso.test.tsで実証する(往復・全単射・スート対称性の3点)。

import type { Card, Suit } from '../engine/types'
import type { FlopDef } from './types'
import { boardFromFlop } from './trainer/gameFlow'
import { FLOPS } from './data/flops'

const ALL_SUITS: readonly Suit[] = ['c', 'd', 'h', 's']

/** nの要素の添字配列(0..n-1)の全順列を生成する(n<=5想定、フロップ3枚専用の小規模ユース)。 */
function permutations(indices: readonly number[]): number[][] {
  if (indices.length <= 1) return [[...indices]]
  const result: number[][] = []
  for (let i = 0; i < indices.length; i++) {
    const rest = [...indices.slice(0, i), ...indices.slice(i + 1)]
    for (const p of permutations(rest)) result.push([indices[i], ...p])
  }
  return result
}

/**
 * カード集合(順序不問)を「ランク降順+その中でのスート同値パターン」の正規形へ並べる。
 * 複数枚が同ランクの場合、どちらを先に置くかでスートラベルの割当が変わり得るため、
 * ランク降順を満たす全並びを試し、パターン文字列が辞書順最小になる並びを正規形として選ぶ
 * (これにより、スートの物理的な割当に依存しない・任意のスート置換で不変なキーになる。
 * flopIso.test.tsの「往復」「スート対称性」テストで実証する)。
 */
function canonicalOrdering(cards: readonly Card[]): Card[] {
  const idx = cards.map((_, i) => i)
  let best: { order: Card[]; pattern: string } | null = null
  for (const perm of permutations(idx)) {
    const seq = perm.map((i) => cards[i])
    let nonIncreasing = true
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1].rank < seq[i].rank) {
        nonIncreasing = false
        break
      }
    }
    if (!nonIncreasing) continue
    const labels = new Map<Suit, string>()
    let pattern = ''
    for (const c of seq) {
      if (!labels.has(c.suit)) labels.set(c.suit, String.fromCharCode(97 + labels.size))
      pattern += labels.get(c.suit)
    }
    if (best === null || pattern < best.pattern) best = { order: seq, pattern }
  }
  // cards.length>=1なら「元の並びそのもの」が必ずランク降順チェックの候補に含まれるとは
  // 限らないが、permutations()は全順列を尽くすため、非空配列なら必ず1つは非減少(rank降順)
  // な並びが見つかる(元の並びをランクでソートしたものが必ず候補に含まれるため)。
  if (!best) throw new Error('canonicalOrdering: no valid ordering found (unexpected empty input)')
  return best.order
}

function canonicalKeyOf(order: readonly Card[]): string {
  const ranksPart = order.map((c) => c.rank).join(',')
  const labels = new Map<Suit, string>()
  let pattern = ''
  for (const c of order) {
    if (!labels.has(c.suit)) labels.set(c.suit, String.fromCharCode(97 + labels.size))
    pattern += labels.get(c.suit)
  }
  return `${ranksPart}|${pattern}`
}

/** 3枚のフロップの同型クラスキー(スート置換で不変)。テスト・デバッグ用にexportする。 */
export function canonicalFlopKey(cards: readonly Card[]): string {
  return canonicalKeyOf(canonicalOrdering(cards))
}

export interface IsomorphicFlopMatch {
  flop: FlopDef
  /** 入力のスートを収録フロップのスートへ写す全単射(4スート全てを含む)。 */
  suitMap: Record<Suit, Suit>
}

/**
 * 収録フロップ(FLOPS)の正規順・正規化キーを初回呼び出し時に1度だけ計算してキャッシュする
 * (findIsomorphicStoredFlopは全フロップ入力探索(コンボ全列挙等)で大量に呼ばれうるため、
 * 95件分の正規化を毎回やり直さない)。FLOPS自体は静的データ(flops.json由来)で
 * 実行中に変わらない前提。
 */
let storedIndexCache: { key: string; flop: FlopDef; order: Card[] }[] | null = null
function storedIndex(): { key: string; flop: FlopDef; order: Card[] }[] {
  if (!storedIndexCache) {
    storedIndexCache = FLOPS.map((flop) => {
      const order = canonicalOrdering(boardFromFlop(flop))
      return { key: canonicalKeyOf(order), flop, order }
    })
  }
  return storedIndexCache
}

/**
 * 入力フロップ(3枚)と同型(スート置換で一致)の収録フロップを探す。
 * 見つからなければnull。返すsuitMapは入力→収録側への4スート全単射
 * (フロップに登場しないスートは辞書順で決定的に割り当てる、手札/ターン/リバーにも
 * 同じ写像を適用できるようにするため)。
 */
export function findIsomorphicStoredFlop(cards: readonly Card[]): IsomorphicFlopMatch | null {
  if (cards.length !== 3) throw new Error(`findIsomorphicStoredFlop: expected 3 cards, got ${cards.length}`)
  const inputOrder = canonicalOrdering(cards)
  const inputKey = canonicalKeyOf(inputOrder)

  for (const { key, flop, order: storedOrder } of storedIndex()) {
    if (key !== inputKey) continue

    // 正規順の対応する位置同士がスート写像を与える(正規化の構成上、同じラベルの位置は
    // 同じスートを持つため、この位置対応は矛盾なく一貫している)。
    const partialMap = new Map<Suit, Suit>()
    for (let i = 0; i < inputOrder.length; i++) {
      const from = inputOrder[i].suit
      const to = storedOrder[i].suit
      const existing = partialMap.get(from)
      if (existing !== undefined && existing !== to) {
        throw new Error(`findIsomorphicStoredFlop: internal invariant violated — inconsistent suit mapping for "${from}"`)
      }
      partialMap.set(from, to)
    }

    // フロップに登場しないスートは辞書順で決定的に割り当てる(手札等の残りスート用)。
    const usedFrom = new Set(partialMap.keys())
    const usedTo = new Set(partialMap.values())
    const remainingFrom = ALL_SUITS.filter((s) => !usedFrom.has(s))
    const remainingTo = ALL_SUITS.filter((s) => !usedTo.has(s))
    for (let i = 0; i < remainingFrom.length; i++) partialMap.set(remainingFrom[i], remainingTo[i])

    const suitMap = Object.fromEntries(partialMap) as Record<Suit, Suit>
    return { flop, suitMap }
  }
  return null
}

/** suitMapをカード列へ適用する(手札・ターン・リバーにも同じ写像を使う)。 */
export function applySuitMap(cards: readonly Card[], suitMap: Record<Suit, Suit>): Card[] {
  return cards.map((c) => ({ rank: c.rank, suit: suitMap[c.suit] }))
}

/** suitMapが4スートの全単射であることを検証する(テスト・呼び出し側の防御用)。 */
export function isBijectiveSuitMap(suitMap: Record<Suit, Suit>): boolean {
  const values = ALL_SUITS.map((s) => suitMap[s])
  if (values.some((v) => v === undefined)) return false
  return new Set(values).size === ALL_SUITS.length
}
