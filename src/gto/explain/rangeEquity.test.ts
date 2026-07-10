/// <reference types="node" />
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { computeSharedRunoutEquity, defaultRunoutStride } from './rangeEquity'
import { calculateEquityExact } from '../../analysis/equity'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import { createDeck, cardKey } from '../../engine/deck'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

const BOARD: Card[] = [card(13, 'c'), card(11, 'c'), card(2, 'd')] // Kc Jc 2d

describe('computeSharedRunoutEquity', () => {
  it('stride=1(全1176ランアウト)は単一villainコンボに対してcalculateEquityExactと±0.001で一致する', () => {
    const hero: Combo = [card(14, 'h'), card(14, 's')] // AhAs
    const villain: Combo = [card(9, 'd'), card(9, 'c')] // 9d9c

    const expected = calculateEquityExact([hero[0], hero[1]], [[villain[0], villain[1]]], BOARD)

    const result = computeSharedRunoutEquity({
      heroCombos: [hero],
      heroWeights: [1],
      villainCombos: [villain],
      villainWeights: [1],
      board: BOARD,
      runoutStride: 1,
    })

    expect(result.heroEquity[0]).toBeCloseTo(expected.equity, 3)
  })

  it('複数villainコンボの重み付き平均は、各コンボ単独のcalculateEquityExactの加重平均と一致する(重複カードなし)', () => {
    const hero: Combo = [card(14, 'h'), card(14, 's')] // AhAs
    const villainA: Combo = [card(9, 'd'), card(9, 'c')] // 9d9c
    const villainB: Combo = [card(8, 'h'), card(7, 'h')] // 8h7h(heroと非衝突)

    const eqA = calculateEquityExact([hero[0], hero[1]], [[villainA[0], villainA[1]]], BOARD).equity
    const eqB = calculateEquityExact([hero[0], hero[1]], [[villainB[0], villainB[1]]], BOARD).equity
    const wA = 2
    const wB = 1
    const expectedWeighted = (eqA * wA + eqB * wB) / (wA + wB)

    const result = computeSharedRunoutEquity({
      heroCombos: [hero],
      heroWeights: [1],
      villainCombos: [villainA, villainB],
      villainWeights: [wA, wB],
      board: BOARD,
      runoutStride: 1,
    })

    expect(result.heroEquity[0]).toBeCloseTo(expectedWeighted, 3)
  })

  it('stride=12はstride=1と±0.02以内で一致する(中規模レンジ、明示指定)', () => {
    const usedKeys = new Set(BOARD.map(cardKey))
    const remaining = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
    const heroCombos: Combo[] = []
    for (let i = 0; i < 20 && heroCombos.length < 15; i++) {
      heroCombos.push([remaining[i], remaining[i + 20]])
    }
    const villainCombos: Combo[] = []
    for (let i = 0; i < 20 && villainCombos.length < 15; i++) {
      villainCombos.push([remaining[remaining.length - 1 - i], remaining[remaining.length - 21 - i]])
    }
    const heroWeights = heroCombos.map(() => 1)
    const villainWeights = villainCombos.map(() => 1)

    const exact = computeSharedRunoutEquity({ heroCombos, heroWeights, villainCombos, villainWeights, board: BOARD, runoutStride: 1 })
    const strided = computeSharedRunoutEquity({ heroCombos, heroWeights, villainCombos, villainWeights, board: BOARD, runoutStride: 12 })

    expect(Math.abs(exact.heroAvgEquity - strided.heroAvgEquity)).toBeLessThan(0.02)
    expect(Math.abs(exact.villainAvgEquity - strided.villainAvgEquity)).toBeLessThan(0.02)
  })

  describe('defaultRunoutStride(runoutStride省略時の自動決定)', () => {
    // 当初計画はevaluate()を数μs級と見積もり固定stride=12を既定としていたが、
    // 実測ではjsdom環境で約15μs/回かかり、実際のソルバーレンジ規模(数百コンボ)
    // では固定stride=12は1秒を超える(性能ガード参照)。総評価回数を一定予算に
    // 収めるようレンジサイズから逆算する設計に変更した。ここではその挙動
    // (小さいレンジほど密に・大きいレンジほど粗くサンプリングする)を検証する。
    it('小さいレンジ(合計30コンボ)では密なstride(<=12程度)になる', () => {
      const stride = defaultRunoutStride(1176, 30)
      expect(stride).toBeLessThanOrEqual(12)
      expect(stride).toBeGreaterThanOrEqual(1)
    })

    it('大きいレンジ(合計973コンボ、実データ相当)では粗いstride(>=30)になる', () => {
      const stride = defaultRunoutStride(1176, 973)
      expect(stride).toBeGreaterThanOrEqual(30)
    })

    it('省略時に実際computeSharedRunoutEquityへ反映される(明示指定と同じ結果になる)', () => {
      const usedKeys = new Set(BOARD.map(cardKey))
      const remaining = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
      const heroCombos: Combo[] = [[remaining[0], remaining[1]]]
      const villainCombos: Combo[] = [[remaining[2], remaining[3]]]
      const heroWeights = [1]
      const villainWeights = [1]

      const stride = defaultRunoutStride(1176, heroCombos.length + villainCombos.length)
      const withDefault = computeSharedRunoutEquity({ heroCombos, heroWeights, villainCombos, villainWeights, board: BOARD })
      const withExplicit = computeSharedRunoutEquity({ heroCombos, heroWeights, villainCombos, villainWeights, board: BOARD, runoutStride: stride })

      expect(withDefault.heroEquity[0]).toBe(withExplicit.heroEquity[0])
    })
  })

  it('決定論的: 同じ入力を2回計算すると完全に一致する', () => {
    const usedKeys = new Set(BOARD.map(cardKey))
    const remaining = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
    const heroCombos: Combo[] = [[remaining[0], remaining[1]], [remaining[2], remaining[3]]]
    const villainCombos: Combo[] = [[remaining[4], remaining[5]], [remaining[6], remaining[7]]]
    const input = { heroCombos, heroWeights: [1, 1], villainCombos, villainWeights: [1, 1], board: BOARD }

    const r1 = computeSharedRunoutEquity(input)
    const r2 = computeSharedRunoutEquity(input)

    expect(Array.from(r1.heroEquity)).toEqual(Array.from(r2.heroEquity))
    expect(Array.from(r1.villainEquity)).toEqual(Array.from(r2.villainEquity))
    expect(r1.heroAvgEquity).toBe(r2.heroAvgEquity)
  })

  it('hero-villain間でカードを共有するvillainコンボは自動的に除外される(結果が変わらない)', () => {
    const hero: Combo = [card(14, 'h'), card(13, 'h')] // AhKh
    const villainClean: Combo = [card(9, 'd'), card(9, 'c')] // 9d9c(heroと非衝突)
    const villainBlocked: Combo = [card(14, 'h'), card(5, 'd')] // AhXX(heroのAhと衝突・本来存在しえない組)

    const withoutBlocked = computeSharedRunoutEquity({
      heroCombos: [hero],
      heroWeights: [1],
      villainCombos: [villainClean],
      villainWeights: [1],
      board: BOARD,
      runoutStride: 1,
    })
    const withBlockedAdded = computeSharedRunoutEquity({
      heroCombos: [hero],
      heroWeights: [1],
      villainCombos: [villainClean, villainBlocked],
      villainWeights: [1, 1],
      board: BOARD,
      runoutStride: 1,
    })

    expect(withBlockedAdded.heroEquity[0]).toBeCloseTo(withoutBlocked.heroEquity[0], 6)
  })

  it('重み0のコンボはNaNを返し、加重平均の計算から除外される', () => {
    const usedKeys = new Set(BOARD.map(cardKey))
    const remaining = createDeck().filter((c) => !usedKeys.has(cardKey(c)))
    const heroCombos: Combo[] = [[remaining[0], remaining[1]], [remaining[2], remaining[3]]]
    const villainCombos: Combo[] = [[remaining[4], remaining[5]]]

    const result = computeSharedRunoutEquity({
      heroCombos,
      heroWeights: [1, 0],
      villainCombos,
      villainWeights: [1],
      board: BOARD,
      runoutStride: 1,
    })

    expect(Number.isNaN(result.heroEquity[1])).toBe(true)
    expect(Number.isFinite(result.heroEquity[0])).toBe(true)
  })

  describe('性能ガード(実.binの解コンボ表による実データ規模テスト)', () => {
    // 合成コンボ(デッキの一部を機械的にペア化)は特定のカードへの偏在が極端になり
    // (少数のアンカーカードに大量のコンボが集中する)、実際の解コンボ表(レンジ
    // 展開由来でカード空間に自然に分散している)より不利なブロッキング補正負荷に
    // なる。本番相当の規模・分布で計測するため、実.binのoopCombos/ipCombosを使う。
    let solution: DecodedSolution

    beforeAll(async () => {
      const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/AsQsJs.bin')
      const buf = await readFile(binPath)
      const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      solution = decodeSolutionFile(arrayBuf)
    })

    it('本番相当のコンボ数(oopCombos x ipCombos)・stride省略(自動決定)で500ms未満', () => {
      const heroCombos = solution.oopCombos
      const villainCombos = solution.ipCombos
      const heroWeights = heroCombos.map(() => 1)
      const villainWeights = villainCombos.map(() => 1)

      const start = performance.now()
      computeSharedRunoutEquity({ heroCombos, heroWeights, villainCombos, villainWeights, board: solution.flop })
      const elapsed = performance.now() - start

      expect(heroCombos.length).toBeGreaterThan(100)
      expect(villainCombos.length).toBeGreaterThan(100)
      expect(elapsed).toBeLessThan(500)
    })
  })
})
