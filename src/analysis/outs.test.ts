import { describe, it, expect } from 'vitest'
import { classifyDraws, drawOutCards } from './outs'
import type { Card } from '../engine/types'
import { createDeck } from '../engine/deck'
import { evaluate } from '../engine/evaluator'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`
}

function exhaustiveStraightOuts(hole: readonly Card[], board: readonly Card[]): number {
  const known = [...hole, ...board]
  const knownKeys = new Set(known.map(cardKey))
  const straightOrBetter = new Set(['STRAIGHT', 'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH'])
  return createDeck().filter((card) => !knownKeys.has(cardKey(card)) && straightOrBetter.has(evaluate([...known, card]).category)).length
}

describe('classifyDraws - 残りデッキ全列挙との交差検証', () => {
  const cases = [
    { name: 'K♣K♦ / A♠Q♠J♠', hole: [c(13, 'c'), c(13, 'd')], board: [c(14, 's'), c(12, 's'), c(11, 's')], outs: 4, kind: 'gutshot' },
    { name: 'A♣K♦ / Q♠J♥2♦', hole: [c(14, 'c'), c(13, 'd')], board: [c(12, 's'), c(11, 'h'), c(2, 'd')], outs: 4, kind: 'gutshot' },
    { name: 'A♣2♦ / 3♠4♥9♦', hole: [c(14, 'c'), c(2, 'd')], board: [c(3, 's'), c(4, 'h'), c(9, 'd')], outs: 4, kind: 'gutshot' },
    { name: '6♣5♦ / 4♠3♥K♦', hole: [c(6, 'c'), c(5, 'd')], board: [c(4, 's'), c(3, 'h'), c(13, 'd')], outs: 8, kind: 'oesd' },
    { name: 'J♣T♦ / 9♠8♥2♦', hole: [c(11, 'c'), c(10, 'd')], board: [c(9, 's'), c(8, 'h'), c(2, 'd')], outs: 8, kind: 'oesd' },
    { name: '5♣4♦ / A♠2♥K♦', hole: [c(5, 'c'), c(4, 'd')], board: [c(14, 's'), c(2, 'h'), c(13, 'd')], outs: 4, kind: 'gutshot' },
  ] as const

  for (const testCase of cases) {
    it(`${testCase.name}: 実カード全列挙と一致する`, () => {
      const draws = classifyDraws([...testCase.hole], [...testCase.board])
      const cards = drawOutCards([...testCase.hole], [...testCase.board]).straight
      expect(exhaustiveStraightOuts(testCase.hole, testCase.board)).toBe(testCase.outs)
      expect(draws.straightDrawOuts).toBe(testCase.outs)
      expect(cards).toHaveLength(testCase.outs)
      expect(draws.hasOESD).toBe(testCase.kind === 'oesd')
      expect(draws.hasGutshot).toBe(testCase.kind === 'gutshot')
    })
  }
})

describe('drawOutCards - フラッシュドロー', () => {
  it('4枚スーテッドのフラッシュドローは該当スートの残り9枚を返す', () => {
    // A♥K♥ on board Q♥J♥2♣ — 4 hearts → flush draw
    const hole = [c(14, 'h'), c(13, 'h')]
    const board = [c(12, 'h'), c(11, 'h'), c(2, 'c')]
    const { flush } = drawOutCards(hole, board)
    expect(flush).toHaveLength(9)
    for (const card of flush) expect(card.suit).toBe('h')
    // 既知カード(A,K,Q,J of hearts)は含まれない
    const flushKeys = new Set(flush.map(cardKey))
    expect(flushKeys.has('14h')).toBe(false)
    expect(flushKeys.has('13h')).toBe(false)
    expect(flushKeys.has('12h')).toBe(false)
    expect(flushKeys.has('11h')).toBe(false)
  })

  it('フラッシュドローが無い場合は空配列', () => {
    const hole = [c(14, 'h'), c(13, 'd')]
    const board = [c(12, 'c'), c(2, 's'), c(7, 'h')]
    const { flush } = drawOutCards(hole, board)
    expect(flush).toHaveLength(0)
  })

  it('classifyDrawsのflushDrawOutsと枚数が一致する', () => {
    const hole = [c(9, 's'), c(8, 's')]
    const board = [c(7, 's'), c(2, 's'), c(14, 'd')]
    const draws = classifyDraws(hole, board)
    const { flush } = drawOutCards(hole, board)
    expect(flush.length).toBe(draws.flushDrawOuts)
  })
})

describe('drawOutCards - ストレートドロー(OESD)', () => {
  it('OESDは欠けている両端ランクの実カード8枚を返す', () => {
    // 9-8 with board 7-6-2 → open-ended (5 or T completes)
    const hole = [c(9, 'c'), c(8, 'd')]
    const board = [c(7, 'h'), c(6, 's'), c(2, 'c')]
    const draws = classifyDraws(hole, board)
    expect(draws.hasOESD).toBe(true)
    const { straight } = drawOutCards(hole, board)
    expect(straight).toHaveLength(8)
    const ranks = new Set(straight.map(card => card.rank))
    expect(ranks).toEqual(new Set([5, 10]))
  })
})

describe('drawOutCards - ストレートドロー(ガットショット)', () => {
  it('ガットショットは欠けている中間ランクの実カード4枚を返す', () => {
    // 9-7 with board 8-2-3 (need a missing card)... use a clean known gutshot: T-8 with board 9-2-3 (need J? no, need... )
    // J-9 hole, board T-2-3 → missing 8 (J-T-9-8-? no). Use: hole 9,7 board 8,6,2 → 9-8-7-6 present, missing 5 or 10 = OESD not gutshot.
    // Clean gutshot: hole K,T board J,9,2 → K-J-T-9 present (gap), need Q to complete K-Q-J-T-9? that's 5 cards K,Q,J,T,9 - missing Q (middle of window [9..13]) → gutshot
    const hole = [c(13, 'c'), c(10, 'd')]
    const board = [c(11, 'h'), c(9, 's'), c(2, 'c')]
    const draws = classifyDraws(hole, board)
    expect(draws.hasGutshot).toBe(true)
    expect(draws.hasOESD).toBe(false)
    const { straight } = drawOutCards(hole, board)
    expect(straight).toHaveLength(4)
    for (const card of straight) expect(card.rank).toBe(12) // Q
  })

  it('Aと6の両側で完成する形は実在ランク14と6を返す', () => {
    // A,4 hole, board 3,2,9 → need a 5 to complete A-2-3-4-5 (wheel), but missing endpoint is "ace低位"なので
    // 実際には A は既知なので "ace低位"の欠け方向ではなく5が欠けるパターンを使う。
    // ここでは A が未知側になるケース: 4,3 hole, board 5,2,9 → need A or 6 (OESD: A-2-3-4-5-6 window)
    const hole = [c(4, 'h'), c(3, 'd')]
    const board = [c(5, 's'), c(2, 'c'), c(9, 'h')]
    const draws = classifyDraws(hole, board)
    expect(draws.hasOESD).toBe(true)
    const { straight } = drawOutCards(hole, board)
    const ranks = new Set(straight.map(card => card.rank))
    // A(14)と6の両端が出るはず(rank 1 という実在しないランクは含まれない)
    expect(ranks.has(1 as Card['rank'])).toBe(false)
    expect(ranks.has(14)).toBe(true)
    expect(ranks.has(6)).toBe(true)
  })
})

describe('drawOutCards - 既知カードの除外', () => {
  it('既にホールカード/ボードにある4枚はアウツに含まれない(残り9枚のみ)', () => {
    const hole = [c(14, 'h'), c(13, 'h')]
    const board = [c(12, 'h'), c(11, 'h'), c(2, 'c')]
    const { flush } = drawOutCards(hole, board)
    expect(flush).toHaveLength(9)
    const flushKeys = new Set(flush.map(cardKey))
    for (const card of [...hole, ...board]) {
      expect(flushKeys.has(cardKey(card))).toBe(false)
    }
  })
})
