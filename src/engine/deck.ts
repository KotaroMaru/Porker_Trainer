import type { Card, Rank, Suit } from './types'

const SUITS: Suit[] = ['c', 'd', 'h', 's']
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

export function shuffle(deck: Card[]): Card[] {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

export function deal(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  return {
    cards: deck.slice(0, count),
    remaining: deck.slice(count),
  }
}

export function removeCards(deck: Card[], remove: Card[]): Card[] {
  const removeSet = new Set(remove.map(cardKey))
  return deck.filter(c => !removeSet.has(cardKey(c)))
}

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`
}

export function rankName(rank: Rank): string {
  const names: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  }
  return names[rank] ?? String(rank)
}

export function suitSymbol(suit: Suit): string {
  const symbols: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }
  return symbols[suit]
}

export function cardLabel(card: Card): string {
  return `${rankName(card.rank)}${suitSymbol(card.suit)}`
}
