import type { Card, Rank, Suit } from '../engine/types'
import { cardKey } from '../engine/deck'

export type Combo = [Card, Card]
export type HandRange = Set<string>

const SUITS: Suit[] = ['c', 'd', 'h', 's']

const RANK_LETTER_TO_NUM: Record<string, Rank> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
}

/** ハンド表記('AKs','AKo','TT')を実際のカードコンボに展開する。ペア=6/スーテッド=4/オフスーツ=12通り。 */
export function expandHandStr(handStr: string): Combo[] {
  const r1 = RANK_LETTER_TO_NUM[handStr[0]]
  const r2 = RANK_LETTER_TO_NUM[handStr[1]]
  const isPair = handStr.length === 2

  if (isPair) {
    const combos: Combo[] = []
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([{ rank: r1, suit: SUITS[i] }, { rank: r2, suit: SUITS[j] }])
      }
    }
    return combos
  }

  const suited = handStr[2] === 's'
  const combos: Combo[] = []
  if (suited) {
    for (const s of SUITS) {
      combos.push([{ rank: r1, suit: s }, { rank: r2, suit: s }])
    }
  } else {
    for (const s1 of SUITS) {
      for (const s2 of SUITS) {
        if (s1 === s2) continue
        combos.push([{ rank: r1, suit: s1 }, { rank: r2, suit: s2 }])
      }
    }
  }
  return combos
}

/** レンジ(ハンド表記の集合)を、deadカード(ボード等)と衝突しないコンボの配列に展開する。 */
export function expandRange(range: HandRange, dead: Card[]): Combo[] {
  const deadSet = new Set(dead.map(cardKey))
  const combos: Combo[] = []
  for (const handStr of range) {
    for (const combo of expandHandStr(handStr)) {
      if (deadSet.has(cardKey(combo[0])) || deadSet.has(cardKey(combo[1]))) continue
      combos.push(combo)
    }
  }
  return combos
}

/** deadカードを除いた、レンジ内の有効コンボ数(クイズの割合表示等に使用)。 */
export function rangeComboCount(range: HandRange, dead: Card[]): number {
  return expandRange(range, dead).length
}
