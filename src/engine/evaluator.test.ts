import { describe, it, expect } from 'vitest'
import { evaluate, compareHands, handDefiningCards } from './evaluator'
import type { Card } from './types'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

describe('handDefiningCards - highlight only役-forming cards', () => {
  it('high card → no defining cards (no highlight)', () => {
    const r = handDefiningCards([c(14,'s'), c(11,'h'), c(9,'d'), c(6,'c'), c(2,'s'), c(13,'h'), c(4,'d')])
    expect(r.category).toBe('HIGH_CARD')
    expect(r.cards).toHaveLength(0)
  })

  it('one pair → only the 2 paired cards (not kickers)', () => {
    const r = handDefiningCards([c(13,'s'), c(13,'h'), c(11,'d'), c(7,'c'), c(3,'s'), c(2,'h'), c(5,'d')])
    expect(r.category).toBe('ONE_PAIR')
    expect(r.cards).toHaveLength(2)
    expect(r.cards.every(x => x.rank === 13)).toBe(true)
  })

  it('two pair → the 4 paired cards', () => {
    const r = handDefiningCards([c(14,'s'), c(14,'h'), c(9,'d'), c(9,'c'), c(5,'s'), c(2,'h'), c(3,'d')])
    expect(r.category).toBe('TWO_PAIR')
    expect(r.cards).toHaveLength(4)
  })

  it('flush → all 5 flush cards', () => {
    const r = handDefiningCards([c(14,'d'), c(11,'d'), c(8,'d'), c(6,'d'), c(3,'d'), c(2,'s'), c(13,'h')])
    expect(r.category).toBe('FLUSH')
    expect(r.cards).toHaveLength(5)
    expect(r.cards.every(x => x.suit === 'd')).toBe(true)
  })

  it('trips → only the 3 cards', () => {
    const r = handDefiningCards([c(7,'s'), c(7,'h'), c(7,'d'), c(13,'c'), c(2,'s'), c(9,'h'), c(4,'d')])
    expect(r.category).toBe('THREE_OF_A_KIND')
    expect(r.cards).toHaveLength(3)
  })
})

describe('evaluate - hand categories', () => {
  it('detects royal flush', () => {
    const cards = [c(14,'h'), c(13,'h'), c(12,'h'), c(11,'h'), c(10,'h'), c(2,'d'), c(3,'d')]
    expect(evaluate(cards).category).toBe('ROYAL_FLUSH')
  })

  it('detects straight flush', () => {
    const cards = [c(9,'s'), c(8,'s'), c(7,'s'), c(6,'s'), c(5,'s'), c(2,'d'), c(3,'d')]
    expect(evaluate(cards).category).toBe('STRAIGHT_FLUSH')
  })

  it('detects wheel straight flush (A-5)', () => {
    const cards = [c(14,'c'), c(2,'c'), c(3,'c'), c(4,'c'), c(5,'c'), c(7,'h'), c(9,'d')]
    expect(evaluate(cards).category).toBe('STRAIGHT_FLUSH')
  })

  it('detects four of a kind', () => {
    const cards = [c(8,'c'), c(8,'d'), c(8,'h'), c(8,'s'), c(5,'c'), c(2,'h'), c(3,'d')]
    expect(evaluate(cards).category).toBe('FOUR_OF_A_KIND')
  })

  it('detects full house', () => {
    const cards = [c(7,'c'), c(7,'d'), c(7,'h'), c(4,'s'), c(4,'c'), c(2,'d'), c(3,'h')]
    expect(evaluate(cards).category).toBe('FULL_HOUSE')
  })

  it('detects flush', () => {
    const cards = [c(2,'d'), c(5,'d'), c(7,'d'), c(9,'d'), c(11,'d'), c(3,'h'), c(4,'c')]
    expect(evaluate(cards).category).toBe('FLUSH')
  })

  it('detects straight', () => {
    const cards = [c(5,'c'), c(6,'d'), c(7,'h'), c(8,'s'), c(9,'c'), c(2,'h'), c(3,'d')]
    expect(evaluate(cards).category).toBe('STRAIGHT')
  })

  it('detects broadway straight (A-high)', () => {
    const cards = [c(14,'c'), c(13,'d'), c(12,'h'), c(11,'s'), c(10,'c'), c(2,'h'), c(3,'d')]
    expect(evaluate(cards).category).toBe('STRAIGHT')
  })

  it('detects wheel straight (A-2-3-4-5)', () => {
    const cards = [c(14,'c'), c(2,'d'), c(3,'h'), c(4,'s'), c(5,'c'), c(7,'h'), c(9,'d')]
    expect(evaluate(cards).category).toBe('STRAIGHT')
  })

  it('detects three of a kind', () => {
    const cards = [c(6,'c'), c(6,'d'), c(6,'h'), c(4,'s'), c(2,'c'), c(8,'h'), c(10,'d')]
    expect(evaluate(cards).category).toBe('THREE_OF_A_KIND')
  })

  it('detects two pair', () => {
    const cards = [c(5,'c'), c(5,'d'), c(9,'h'), c(9,'s'), c(2,'c'), c(8,'h'), c(10,'d')]
    expect(evaluate(cards).category).toBe('TWO_PAIR')
  })

  it('detects one pair', () => {
    const cards = [c(3,'c'), c(3,'d'), c(6,'h'), c(8,'s'), c(10,'c'), c(2,'h'), c(14,'d')]
    expect(evaluate(cards).category).toBe('ONE_PAIR')
  })

  it('detects high card', () => {
    const cards = [c(2,'c'), c(4,'d'), c(6,'h'), c(8,'s'), c(10,'c'), c(12,'h'), c(14,'d')]
    expect(evaluate(cards).category).toBe('HIGH_CARD')
  })

  it('works with 5 cards', () => {
    const cards = [c(14,'h'), c(13,'h'), c(12,'h'), c(11,'h'), c(10,'h')]
    expect(evaluate(cards).category).toBe('ROYAL_FLUSH')
  })

  it('works with 6 cards', () => {
    const cards = [c(14,'h'), c(13,'h'), c(12,'h'), c(11,'h'), c(10,'h'), c(2,'d')]
    expect(evaluate(cards).category).toBe('ROYAL_FLUSH')
  })
})

describe('evaluate - kicker comparisons', () => {
  it('higher pair beats lower pair', () => {
    const aces = [c(14,'c'), c(14,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    const kings = [c(13,'c'), c(13,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    expect(evaluate(aces).score).toBeGreaterThan(evaluate(kings).score)
  })

  it('same pair, higher kicker wins', () => {
    const withAce = [c(5,'c'), c(5,'d'), c(14,'h'), c(3,'s'), c(2,'c'), c(8,'h'), c(9,'d')]
    const withKing = [c(5,'c'), c(5,'d'), c(13,'h'), c(3,'s'), c(2,'c'), c(8,'h'), c(9,'d')]
    expect(evaluate(withAce).score).toBeGreaterThan(evaluate(withKing).score)
  })

  it('higher kicker in two pair wins', () => {
    const higherKicker = [c(5,'c'), c(5,'d'), c(9,'h'), c(9,'s'), c(14,'c'), c(2,'h'), c(3,'d')]
    const lowerKicker  = [c(5,'c'), c(5,'d'), c(9,'h'), c(9,'s'), c(13,'c'), c(2,'h'), c(3,'d')]
    expect(evaluate(higherKicker).score).toBeGreaterThan(evaluate(lowerKicker).score)
  })

  it('higher top pair wins in two pair', () => {
    const top9  = [c(5,'c'), c(5,'d'), c(9,'h'), c(9,'s'), c(2,'c'), c(3,'h'), c(4,'d')]
    const top8  = [c(5,'c'), c(5,'d'), c(8,'h'), c(8,'s'), c(2,'c'), c(3,'h'), c(4,'d')]
    expect(evaluate(top9).score).toBeGreaterThan(evaluate(top8).score)
  })

  it('higher three-of-a-kind beats lower', () => {
    const threeAces = [c(14,'c'), c(14,'d'), c(14,'h'), c(2,'s'), c(3,'c'), c(5,'h'), c(9,'d')]
    const threeTwos = [c(2,'c'),  c(2,'d'),  c(2,'h'),  c(7,'s'), c(9,'c'), c(11,'h'), c(13,'d')]
    expect(evaluate(threeAces).score).toBeGreaterThan(evaluate(threeTwos).score)
  })

  it('higher straight wins', () => {
    const broadway = [c(14,'c'), c(13,'d'), c(12,'h'), c(11,'s'), c(10,'c'), c(2,'h'), c(3,'d')]
    const wheel    = [c(14,'c'), c(2,'d'),  c(3,'h'),  c(4,'s'),  c(5,'c'),  c(7,'h'), c(9,'d')]
    expect(evaluate(broadway).score).toBeGreaterThan(evaluate(wheel).score)
  })

  it('higher flush wins', () => {
    const aceFlush = [c(14,'d'), c(9,'d'), c(7,'d'), c(5,'d'), c(2,'d'), c(3,'h'), c(4,'c')]
    const kingFlush= [c(13,'d'), c(9,'d'), c(7,'d'), c(5,'d'), c(2,'d'), c(3,'h'), c(4,'c')]
    expect(evaluate(aceFlush).score).toBeGreaterThan(evaluate(kingFlush).score)
  })

  it('higher full house wins', () => {
    const aaakk = [c(14,'c'), c(14,'d'), c(14,'h'), c(13,'s'), c(13,'c'), c(2,'h'), c(3,'d')]
    const kkkaa = [c(13,'c'), c(13,'d'), c(13,'h'), c(14,'s'), c(14,'c'), c(2,'h'), c(3,'d')]
    expect(evaluate(aaakk).score).toBeGreaterThan(evaluate(kkkaa).score)
  })

  it('higher four of a kind wins', () => {
    const fourAces  = [c(14,'c'), c(14,'d'), c(14,'h'), c(14,'s'), c(2,'c'), c(3,'h'), c(4,'d')]
    const fourTwos  = [c(2,'c'),  c(2,'d'),  c(2,'h'),  c(2,'s'),  c(3,'c'), c(4,'h'), c(5,'d')]
    expect(evaluate(fourAces).score).toBeGreaterThan(evaluate(fourTwos).score)
  })
})

describe('compareHands - split pot detection', () => {
  it('returns 0 for identical hands (split)', () => {
    const hand1 = [c(14,'c'), c(13,'d'), c(12,'h'), c(11,'s'), c(10,'c'), c(2,'h'), c(3,'d')]
    const hand2 = [c(14,'s'), c(13,'h'), c(12,'d'), c(11,'c'), c(10,'s'), c(2,'d'), c(3,'h')]
    expect(compareHands(hand1, hand2)).toBe(0)
  })

  it('returns 1 if hand1 wins', () => {
    const hand1 = [c(14,'c'), c(14,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    const hand2 = [c(13,'c'), c(13,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    expect(compareHands(hand1, hand2)).toBe(1)
  })

  it('returns -1 if hand2 wins', () => {
    const hand1 = [c(13,'c'), c(13,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    const hand2 = [c(14,'c'), c(14,'d'), c(2,'h'), c(3,'s'), c(4,'c'), c(7,'h'), c(8,'d')]
    expect(compareHands(hand1, hand2)).toBe(-1)
  })
})

describe('evaluate - category ordering', () => {
  const hands = {
    HIGH_CARD:       [c(2,'c'), c(4,'d'), c(6,'h'), c(8,'s'), c(10,'c'), c(12,'h'), c(14,'d')],
    ONE_PAIR:        [c(3,'c'), c(3,'d'), c(6,'h'), c(8,'s'), c(10,'c'), c(2,'h'), c(14,'d')],
    TWO_PAIR:        [c(5,'c'), c(5,'d'), c(9,'h'), c(9,'s'), c(2,'c'), c(8,'h'), c(10,'d')],
    THREE_OF_A_KIND: [c(6,'c'), c(6,'d'), c(6,'h'), c(4,'s'), c(2,'c'), c(8,'h'), c(10,'d')],
    STRAIGHT:        [c(5,'c'), c(6,'d'), c(7,'h'), c(8,'s'), c(9,'c'), c(2,'h'), c(3,'d')],
    FLUSH:           [c(2,'d'), c(5,'d'), c(7,'d'), c(9,'d'), c(11,'d'), c(3,'h'), c(4,'c')],
    FULL_HOUSE:      [c(7,'c'), c(7,'d'), c(7,'h'), c(4,'s'), c(4,'c'), c(2,'d'), c(3,'h')],
    FOUR_OF_A_KIND:  [c(8,'c'), c(8,'d'), c(8,'h'), c(8,'s'), c(5,'c'), c(2,'h'), c(3,'d')],
    STRAIGHT_FLUSH:  [c(9,'s'), c(8,'s'), c(7,'s'), c(6,'s'), c(5,'s'), c(2,'d'), c(3,'d')],
    ROYAL_FLUSH:     [c(14,'h'), c(13,'h'), c(12,'h'), c(11,'h'), c(10,'h'), c(2,'d'), c(3,'d')],
  }

  const order = ['HIGH_CARD','ONE_PAIR','TWO_PAIR','THREE_OF_A_KIND','STRAIGHT','FLUSH','FULL_HOUSE','FOUR_OF_A_KIND','STRAIGHT_FLUSH','ROYAL_FLUSH'] as const

  for (let i = 0; i < order.length - 1; i++) {
    const lo = order[i]
    const hi = order[i + 1]
    it(`${hi} beats ${lo}`, () => {
      const loScore = evaluate(hands[lo]).score
      const hiScore = evaluate(hands[hi]).score
      expect(hiScore).toBeGreaterThan(loScore)
    })
  }
})
