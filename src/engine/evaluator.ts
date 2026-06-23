import type { Card, HandCategory, HandResult } from './types'

const CATEGORY_RANK: Record<HandCategory, number> = {
  HIGH_CARD: 1,
  ONE_PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10,
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length === 0) return []
  const [first, ...rest] = arr
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

function evaluate5(cards: Card[]): HandResult {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)

  const isFlush = suits.every(s => s === suits[0])

  const rankCounts = new Map<number, number>()
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1)

  const counts = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  let isStraight = false
  let straightHigh = 0

  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a)
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true
      straightHigh = uniqueRanks[0]
    }
    // wheel: A-2-3-4-5
    if (uniqueRanks[0] === 14 && uniqueRanks[1] === 5 && uniqueRanks[2] === 4 && uniqueRanks[3] === 3 && uniqueRanks[4] === 2) {
      isStraight = true
      straightHigh = 5
    }
  }

  const countGroups = counts.map(([, count]) => count)

  let category: HandCategory
  let tiebreakers: number[]

  if (isFlush && isStraight) {
    category = straightHigh === 14 ? 'ROYAL_FLUSH' : 'STRAIGHT_FLUSH'
    tiebreakers = [straightHigh]
  } else if (countGroups[0] === 4) {
    category = 'FOUR_OF_A_KIND'
    tiebreakers = counts.map(([r]) => r)
  } else if (countGroups[0] === 3 && countGroups[1] === 2) {
    category = 'FULL_HOUSE'
    tiebreakers = counts.map(([r]) => r)
  } else if (isFlush) {
    category = 'FLUSH'
    tiebreakers = ranks
  } else if (isStraight) {
    category = 'STRAIGHT'
    tiebreakers = [straightHigh]
  } else if (countGroups[0] === 3) {
    category = 'THREE_OF_A_KIND'
    tiebreakers = counts.map(([r]) => r)
  } else if (countGroups[0] === 2 && countGroups[1] === 2) {
    category = 'TWO_PAIR'
    tiebreakers = counts.map(([r]) => r)
  } else if (countGroups[0] === 2) {
    category = 'ONE_PAIR'
    tiebreakers = counts.map(([r]) => r)
  } else {
    category = 'HIGH_CARD'
    tiebreakers = ranks
  }

  // Encode score: category * 15^6 + tiebreaker0*15^5 + ... (base-15 big-endian, max rank=14)
  const BASE = 15
  let score = CATEGORY_RANK[category] * BASE ** 5
  for (let i = 0; i < Math.min(tiebreakers.length, 5); i++) {
    score += tiebreakers[i] * BASE ** (4 - i)
  }

  return { category, score, cards }
}

export function evaluate(cards: Card[]): HandResult {
  const combs = cards.length === 5 ? [cards] : combinations(cards, 5)
  let best: HandResult | null = null
  for (const five of combs) {
    const result = evaluate5(five)
    if (!best || result.score > best.score) best = result
  }
  return best!
}

export function compareHands(cards1: Card[], cards2: Card[]): -1 | 0 | 1 {
  const s1 = evaluate(cards1).score
  const s2 = evaluate(cards2).score
  if (s1 > s2) return 1
  if (s1 < s2) return -1
  return 0
}

/**
 * 役を「構成しているカード」だけを返す (キッカーは含めない)。
 * ペア/2ペア/トリップス/クアッズ → 同ランクのカードのみ。
 * ストレート/フラッシュ/フルハウス/ストフラ → ベスト5枚すべて。
 * ハイカード → 構成カードなし (ハイライト無し)。
 */
export function handDefiningCards(sevenCards: Card[]): { category: HandCategory; cards: Card[] } {
  const result = evaluate(sevenCards)
  const five = result.cards
  const byRank = new Map<number, Card[]>()
  for (const c of five) {
    const arr = byRank.get(c.rank) ?? []
    arr.push(c)
    byRank.set(c.rank, arr)
  }
  const groups = [...byRank.values()]

  let cards: Card[]
  switch (result.category) {
    case 'ONE_PAIR':
      cards = groups.find(g => g.length === 2) ?? []
      break
    case 'TWO_PAIR':
      cards = groups.filter(g => g.length === 2).flat()
      break
    case 'THREE_OF_A_KIND':
      cards = groups.find(g => g.length === 3) ?? []
      break
    case 'FOUR_OF_A_KIND':
      cards = groups.find(g => g.length === 4) ?? []
      break
    case 'HIGH_CARD':
      cards = []
      break
    default:
      // STRAIGHT / FLUSH / FULL_HOUSE / STRAIGHT_FLUSH / ROYAL_FLUSH
      cards = five
  }
  return { category: result.category, cards }
}
