import { describe, it, expect } from 'vitest'
import { rustIdFromCard, comboRustKey, buildComboIndexMap, lookupComboIndex } from './comboIndex'
import type { Card } from '../../engine/types'

describe('rustIdFromCard', () => {
  it('postflop-solverのcard_from_str例と一致する(2c=0, 3d=5, 4h=10, As=51)', () => {
    expect(rustIdFromCard({ rank: 2, suit: 'c' })).toBe(0)
    expect(rustIdFromCard({ rank: 3, suit: 'd' })).toBe(5)
    expect(rustIdFromCard({ rank: 4, suit: 'h' })).toBe(10)
    expect(rustIdFromCard({ rank: 14, suit: 's' })).toBe(51)
  })
})

describe('comboRustKey', () => {
  it('カードの順序に依存せず同じキーを返す', () => {
    const a: Card = { rank: 14, suit: 's' }
    const b: Card = { rank: 2, suit: 'c' }
    expect(comboRustKey([a, b])).toBe(comboRustKey([b, a]))
  })
})

describe('buildComboIndexMap / lookupComboIndex', () => {
  it('rust IDペアの配列からインデックスを正しく引ける(順序入れ替えも同一視)', () => {
    const rustCombos: [number, number][] = [
      [0, 5], // 2c,3d
      [10, 51], // 4h,As
    ]
    const map = buildComboIndexMap(rustCombos)
    const idx0 = lookupComboIndex(map, [{ rank: 2, suit: 'c' }, { rank: 3, suit: 'd' }])
    expect(idx0).toBe(0)
    // 順序を入れ替えても同じインデックス
    const idx0Swapped = lookupComboIndex(map, [{ rank: 3, suit: 'd' }, { rank: 2, suit: 'c' }])
    expect(idx0Swapped).toBe(0)
    const idx1 = lookupComboIndex(map, [{ rank: 4, suit: 'h' }, { rank: 14, suit: 's' }])
    expect(idx1).toBe(1)
  })

  it('存在しないコンボはエラーを投げる', () => {
    const map = buildComboIndexMap([[0, 5]])
    expect(() => lookupComboIndex(map, [{ rank: 14, suit: 'h' }, { rank: 13, suit: 'h' }])).toThrow()
  })
})
