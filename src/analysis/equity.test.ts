import { describe, it, expect } from 'vitest'
import { calculateEquity, calculateEquityExact, monteCarloRangeEquity } from './equity'
import { expandHandStr } from './range'
import type { Card } from '../engine/types'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

const TOLERANCE = 0.015 // ±1.5%

describe('calculateEquity - preflop heads up (Monte Carlo)', () => {
  it('AA vs KK: AA wins ~81-82%', () => {
    const aa = [c(14,'h'), c(14,'s')]
    const kk = [c(13,'h'), c(13,'s')]
    const result = calculateEquity(aa, [kk], [], 12000)
    expect(result.equity).toBeGreaterThanOrEqual(0.81 - TOLERANCE)
    expect(result.equity).toBeLessThanOrEqual(0.82 + TOLERANCE)
  })

  it('AA vs 72o: AA wins ~88%', () => {
    const aa = [c(14,'c'), c(14,'d')]
    const trash = [c(7,'h'), c(2,'s')]
    const result = calculateEquity(aa, [trash], [], 12000)
    expect(result.equity).toBeGreaterThanOrEqual(0.88 - TOLERANCE)
    expect(result.equity).toBeLessThanOrEqual(0.88 + TOLERANCE + 0.02)
  })

  it('AKs vs AKo: roughly 50-50', () => {
    const aks = [c(14,'h'), c(13,'h')]
    const ako = [c(14,'d'), c(13,'c')]
    const result = calculateEquity(aks, [ako], [], 12000)
    expect(result.equity).toBeGreaterThanOrEqual(0.45)
    expect(result.equity).toBeLessThanOrEqual(0.55)
  })
})

describe('calculateEquityExact - flop/turn (exact enumeration)', () => {
  it('flush draw vs top pair on flop: ~35% for flush draw', () => {
    // hero: A♥K♥ on board Q♥J♥2♣ — flush draw + overcards
    const hero = [c(14,'h'), c(13,'h')]
    const villain2 = [c(12,'s'), c(2,'d')]
    const board = [c(12,'d'), c(11,'h'), c(2,'h')]
    const result = calculateEquityExact(hero, [villain2], board)
    // Hero has flush draw (9 outs) + backdoor... roughly 35%
    expect(result.equity).toBeGreaterThanOrEqual(0.30 - TOLERANCE)
    expect(result.equity).toBeLessThanOrEqual(0.50)
  })

  it('AA vs flush draw + gutshot on turn: ~73% for AA', () => {
    // hero: A♠A♣, villain: K♥Q♥, board: 2♥7♥J♠9♦
    // villain has: flush draw (9 hearts) + gutshot (T♣T♦T♠) = 12 outs ≈ 24-27%
    const hero = [c(14,'s'), c(14,'c')]
    const villain = [c(13,'h'), c(12,'h')]
    const board = [c(2,'h'), c(7,'h'), c(11,'s'), c(9,'d')]
    const result = calculateEquityExact(hero, [villain], board)
    expect(result.equity).toBeGreaterThanOrEqual(0.70 - TOLERANCE)
    expect(result.equity).toBeLessThanOrEqual(0.78 + TOLERANCE)
  })

  it('river: made hand vs busted draw — 100%', () => {
    // hero: A♠A♣, villain: K♥Q♥ (busted flush draw), board: 2♥7♥J♠9♦3♣
    const hero = [c(14,'s'), c(14,'c')]
    const villain = [c(13,'h'), c(12,'h')]
    const board = [c(2,'h'), c(7,'h'), c(11,'s'), c(9,'d'), c(3,'c')]
    const result = calculateEquityExact(hero, [villain], board)
    expect(result.equity).toBe(1.0)
  })

  it('river split pot: same hand — 50%', () => {
    const hero    = [c(14,'c'), c(13,'d')]
    const villain = [c(14,'s'), c(13,'h')]
    const board   = [c(12,'c'), c(11,'d'), c(10,'s'), c(2,'h'), c(3,'c')]
    // Both have broadway straight
    const result = calculateEquityExact(hero, [villain], board)
    expect(result.equity).toBe(0.5)
  })
})

describe('calculateEquity - range-based (villain range)', () => {
  it('returns equity between 0 and 1', () => {
    const hero = [c(14,'h'), c(14,'s')]
    const result = calculateEquity(hero, [], [], 1000)
    // no villains = 100%
    expect(result.equity).toBe(1.0)
  })
})

describe('monteCarloRangeEquity', () => {
  it('AA固定 vs ランダム1人レンジ(169ハンド全体): 約85%前後', () => {
    const aa: Card[] = [c(14,'h'), c(14,'s')]
    const fullRange = expandHandStr('AKs').concat(
      // 169ハンド全体を厳密に作るのは冗長なので、広いレンジの代表として複数ハンドを束ねる
      expandHandStr('KK'), expandHandStr('QQ'), expandHandStr('72o'), expandHandStr('83s'),
      expandHandStr('JJ'), expandHandStr('T9s'), expandHandStr('A2o'), expandHandStr('65s'),
    )
    const result = monteCarloRangeEquity({
      heroFixed: aa,
      villainRanges: [fullRange],
      board: [],
      iterations: 4000,
    })
    expect(result.total).toBeGreaterThan(0)
    expect(result.equity).toBeGreaterThan(0.65)
    expect(result.equity).toBeLessThan(0.95)
  })

  it('レンジ対レンジ: AA単体レンジ vs 72o単体レンジ(衝突なし) はAAがほぼ確実に勝つ', () => {
    const aaRange = expandHandStr('AA')
    const trashRange = expandHandStr('72o') // AAと衝突しないオフスーツ72
    const result = monteCarloRangeEquity({
      heroRange: aaRange,
      villainRanges: [trashRange],
      board: [],
      iterations: 3000,
    })
    expect(result.total).toBeGreaterThan(0)
    expect(result.equity).toBeGreaterThan(0.8)
  })

  it('ヒーローレンジが空の場合は不正なイテレーションをスキップしtotal=0でequity 0.5を返す', () => {
    const result = monteCarloRangeEquity({
      heroRange: [],
      villainRanges: [expandHandStr('AA')],
      board: [],
      iterations: 100,
    })
    expect(result.total).toBe(0)
    expect(result.equity).toBe(0.5)
  })

  it('リバーで役が確定済みのレンジ対レンジ: ヒーロー固定の役勝ち(フラッシュ) vs 相手レンジ(フラッシュなし) は100%付近', () => {
    // ヒーロー: スペードフラッシュ確定。相手レンジ: 72o(ノーペア、フラッシュ不可なオフスーツ)
    const hero: Card[] = [c(14,'s'), c(13,'s')]
    const board: Card[] = [c(12,'s'), c(10,'s'), c(2,'s'), c(4,'h'), c(5,'d')]
    const villainRange = expandHandStr('72o').filter(([x, y]) => x.suit !== 's' && y.suit !== 's')
    const result = monteCarloRangeEquity({
      heroFixed: hero,
      villainRanges: [villainRange],
      board,
      iterations: 1000,
    })
    expect(result.equity).toBe(1.0)
  })
})
