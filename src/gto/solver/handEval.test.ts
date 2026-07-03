import { describe, it, expect } from 'vitest'
import { compareCombosOnBoard, rankCombosOnBoard, computeRangeVsRangeEquity } from './handEval'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

describe('compareCombosOnBoard', () => {
  it('強い役を持つコンボが勝つ(引数順序に依存しない)', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const setOfAces: Combo = [c(14, 'h'), c(14, 's')] // ワンペア(A)
    const highCard: Combo = [c(13, 'd'), c(11, 'c')] // ハイカード
    const compare = compareCombosOnBoard(board)
    expect(compare(setOfAces, highCard)).toBeGreaterThan(0)
    expect(compare(highCard, setOfAces)).toBeLessThan(0)
  })

  it('同じ役なら引き分け(0)になる', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const a: Combo = [c(13, 'h'), c(12, 's')]
    const b: Combo = [c(13, 'd'), c(12, 'c')]
    const compare = compareCombosOnBoard(board)
    expect(compare(a, b)).toBe(0)
  })
})

describe('rankCombosOnBoard', () => {
  it('強い順にソートされる', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const combos: Combo[] = [
      [c(13, 'd'), c(11, 'c')], // ハイカード
      [c(14, 'h'), c(14, 's')], // ワンペア(A)
      [c(9, 'd'), c(9, 's')], // スリーカード(9)
    ]
    const ranked = rankCombosOnBoard(combos, board)
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score)
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score)
    // 最強はスリーカード(9)のはず
    expect(ranked[0].combo).toEqual([c(9, 'd'), c(9, 's')])
  })
})

describe('computeRangeVsRangeEquity', () => {
  it('常に勝つレンジ vs 常に負けるレンジ: エクイティ1.0/0.0', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const nutsHero: Combo[] = [[c(14, 'h'), c(14, 's')]] // ワンペア(A、最強)
    const weakVillain: Combo[] = [[c(6, 'd'), c(11, 'c')]] // ハイカード(9)のみ
    const result = computeRangeVsRangeEquity(nutsHero, weakVillain, board)
    expect(result.averageEquity).toBeCloseTo(1.0, 6)
  })

  it('ブロッキング: heroの手と重複するvillainコンボは除外される', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const hero: Combo[] = [[c(14, 'h'), c(14, 's')]]
    // villainの2コンボのうち1つはheroとカードが重複(14h)しているので除外され、
    // 残りの1コンボ(6d,5c)だけでエクイティが計算されるはず
    const villain: Combo[] = [
      [c(14, 'h'), c(13, 'd')], // heroの14hと重複 → 除外
      [c(6, 'd'), c(11, 'c')], // 重複なし → 対象
    ]
    const result = computeRangeVsRangeEquity(hero, villain, board)
    expect(result.averageEquity).toBeCloseTo(1.0, 6) // 唯一有効な相手にはheroが必ず勝つ
  })

  it('完全に互角のレンジ同士: エクイティは概ね0.5に近い', () => {
    const board = [c(2, 'c'), c(7, 'd'), c(9, 'h'), c(3, 's'), c(4, 'c')]
    const hero: Combo[] = [[c(13, 'h'), c(12, 's')], [c(11, 'd'), c(10, 'c')]]
    const villain: Combo[] = [[c(13, 's'), c(12, 'h')], [c(11, 'c'), c(10, 'd')]]
    const result = computeRangeVsRangeEquity(hero, villain, board)
    expect(result.averageEquity).toBeGreaterThan(0.4)
    expect(result.averageEquity).toBeLessThan(0.6)
  })
})
