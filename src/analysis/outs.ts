import type { Card } from '../engine/types'
import { evaluate } from '../engine/evaluator'

export interface OutsResult {
  total: number
  breakdown: { label: string; count: number }[]
  approx4: number
  approx2: number
}

function formsStraight(ranks: Set<number>): boolean {
  const withLowAce = new Set(ranks)
  if (ranks.has(14)) withLowAce.add(1)
  const sorted = [...withLowAce].sort((a, b) => a - b)
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run++
      if (run >= 5) return true
    } else if (sorted[i] !== sorted[i - 1]) {
      run = 1
    }
  }
  return false
}

function straightOutRanks(cards: readonly Card[]): Card['rank'][] {
  const ranks = new Set<number>(cards.map((card) => card.rank))
  if (formsStraight(ranks)) return []
  const outRanks: Card['rank'][] = []
  for (let rank = 2; rank <= 14; rank++) {
    if (ranks.has(rank)) continue
    const withRank = new Set(ranks)
    withRank.add(rank)
    if (formsStraight(withRank)) outRanks.push(rank as Card['rank'])
  }
  return outRanks
}

export function detectOuts(holeCards: Card[], board: Card[]): OutsResult {
  const known = [...holeCards, ...board]
  const allRanks = [2,3,4,5,6,7,8,9,10,11,12,13,14] as const
  const allSuits = ['c','d','h','s'] as const

  const knownKeys = new Set(known.map(c => `${c.rank}${c.suit}`))

  const deck: Card[] = []
  for (const rank of allRanks) {
    for (const suit of allSuits) {
      if (!knownKeys.has(`${rank}${suit}`)) {
        deck.push({ rank, suit })
      }
    }
  }

  const currentBest = evaluate(known)
  const outs: Card[] = []

  const CAT_RANK: Record<string, number> = {
    HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_OF_A_KIND: 3,
    STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, FOUR_OF_A_KIND: 7,
    STRAIGHT_FLUSH: 8, ROYAL_FLUSH: 9,
  }

  for (const card of deck) {
    const newHand = [...known, card]
    const newBest = evaluate(newHand)
    // Only count cards that improve to a HIGHER hand category, not kicker improvements
    if (CAT_RANK[newBest.category] > CAT_RANK[currentBest.category]) {
      outs.push(card)
    }
  }

  const total = outs.length

  // classify
  const breakdown: { label: string; count: number }[] = []
  if (total > 0) {
    breakdown.push({ label: 'アウツ合計', count: total })
  }

  return {
    total,
    breakdown,
    approx4: Math.min(total * 4, 100),
    approx2: Math.min(total * 2, 100),
  }
}

export function classifyDraws(holeCards: Card[], board: Card[]): {
  hasFlushDraw: boolean
  hasOESD: boolean
  hasGutshot: boolean
  flushDrawOuts: number
  straightDrawOuts: number
} {
  const all = [...holeCards, ...board]
  const suits = all.map(c => c.suit)

  // flush draw: 4 of the same suit
  const suitCounts = new Map<string, number>()
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1)
  const maxSuitCount = Math.max(...suitCounts.values())
  const hasFlushDraw = maxSuitCount === 4
  const flushDrawOuts = hasFlushDraw ? 9 : 0

  // 各実在ランクを1枚ずつ仮に加え、ストレート成立を直接判定する。
  // Aの上下限で片側にしか伸びない4連続をOESDと誤認しないため、窓の端位置は使わない。
  const outRanks = straightOutRanks(all)
  const hasOESD = outRanks.length >= 2
  const hasGutshot = outRanks.length === 1

  const straightDrawOuts = hasOESD ? 8 : hasGutshot ? 4 : 0

  return { hasFlushDraw, hasOESD, hasGutshot, flushDrawOuts, straightDrawOuts }
}

/**
 * classifyDraws と同じ判定基準で、フラッシュ/ストレートドローのアウツを実カードとして列挙する。
 * 表示専用のヘルパーであり、勝率計算(estimateOuts の4-2ルール概算)には影響しない。
 */
export function drawOutCards(holeCards: Card[], board: Card[]): { flush: Card[]; straight: Card[] } {
  const known = [...holeCards, ...board]
  const knownKeys = new Set(known.map(c => `${c.rank}${c.suit}`))
  const allSuits: Card['suit'][] = ['c', 'd', 'h', 's']
  const allRanks: Card['rank'][] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

  // フラッシュドロー: 4枚同スートが揃っていれば、そのスートの未使用カードがアウツ(最大9枚)
  const suitCounts = new Map<string, number>()
  for (const c of known) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1)
  let flushSuit: Card['suit'] | null = null
  for (const [suit, count] of suitCounts) {
    if (count === 4) flushSuit = suit as Card['suit']
  }
  const flush: Card[] = flushSuit
    ? allRanks
        .map(rank => ({ rank, suit: flushSuit as Card['suit'] }))
        .filter(c => !knownKeys.has(`${c.rank}${c.suit}`))
    : []

  // classifyDraws と同じ直接シミュレーションで、実在する完成ランクだけを列挙する。
  const outRanks = straightOutRanks(known)

  const straight: Card[] = []
  for (const rank of outRanks) {
    for (const suit of allSuits) {
      const card = { rank: rank as Card['rank'], suit }
      if (!knownKeys.has(`${card.rank}${card.suit}`)) straight.push(card)
    }
  }

  return { flush, straight }
}
