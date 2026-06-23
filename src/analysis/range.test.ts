import { describe, it, expect } from 'vitest'
import { expandHandStr, expandRange, rangeComboCount } from './range'
import type { Card } from '../engine/types'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

function comboKey(combo: [Card, Card]): string {
  const [a, b] = combo
  return [`${a.rank}${a.suit}`, `${b.rank}${b.suit}`].sort().join('-')
}

describe('expandHandStr', () => {
  it('ペア(TT)は6コンボ', () => {
    expect(expandHandStr('TT')).toHaveLength(6)
  })

  it('スーテッド(AKs)は4コンボ、いずれも同スートのみ', () => {
    const combos = expandHandStr('AKs')
    expect(combos).toHaveLength(4)
    for (const [a, b] of combos) expect(a.suit).toBe(b.suit)
  })

  it('オフスーツ(AKo)は12コンボ、すべて異スート', () => {
    const combos = expandHandStr('AKo')
    expect(combos).toHaveLength(12)
    for (const [a, b] of combos) expect(a.suit).not.toBe(b.suit)
  })

  it('コンボに重複が無い', () => {
    const combos = expandHandStr('AKo')
    const keys = combos.map(comboKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ランクが正しく解決される(AKsはA=14, K=13)', () => {
    const [combo] = expandHandStr('AKs')
    const ranks = combo.map(card => card.rank).sort((a, b) => a - b)
    expect(ranks).toEqual([13, 14])
  })
})

describe('expandRange', () => {
  it('dead カードと衝突するコンボが除外される', () => {
    const range = new Set(['AKs'])
    const dead: Card[] = [c(14, 's')] // A♠ を使用済みにする
    const combos = expandRange(range, dead)
    // A♠K♠ の1コンボだけが除外され、残り3スート分が残る
    expect(combos).toHaveLength(3)
    for (const [a, b] of combos) {
      expect(a.suit).not.toBe('s')
      expect(b.suit).not.toBe('s')
    }
  })

  it('レンジ全体が dead で消えると空配列になる', () => {
    const range = new Set(['AA'])
    const dead: Card[] = [c(14, 'c'), c(14, 'd'), c(14, 'h'), c(14, 's')]
    expect(expandRange(range, dead)).toHaveLength(0)
  })

  it('複数ハンドのレンジは各ハンドのコンボ数の合計になる', () => {
    const range = new Set(['AA', 'AKs']) // 6 + 4 = 10
    expect(expandRange(range, [])).toHaveLength(10)
  })
})

describe('rangeComboCount', () => {
  it('expandRangeの長さと一致する', () => {
    const range = new Set(['TT', 'AKo'])
    expect(rangeComboCount(range, [])).toBe(expandRange(range, []).length)
  })
})
