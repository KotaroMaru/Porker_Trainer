import { describe, it, expect } from 'vitest'
import { decodeSolutionFile, cardFromRustId } from './binaryFormat'
import { cardKey } from '../../engine/deck'

// tools/solver/crates/precompute/src/export.rs の `round_trip` テストと
// 同じバイト列を手組みして、Rust側ライタが書くバイナリをTS側デコーダが
// 正しく読めることを確認する(FORMAT.md準拠を両実装で突き合わせる)。
function buildFixtureBytes(): ArrayBuffer {
  const bytes: number[] = []
  const pushU8Str = (s: string) => {
    bytes.push(s.length)
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i))
  }
  const pushU16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff)
  }
  const pushU32 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
  }
  const pushI16 = (v: number) => {
    const u = v < 0 ? v + 0x10000 : v
    pushU16(u)
  }

  // header
  bytes.push('G'.charCodeAt(0), 'T'.charCodeAt(0), 'O'.charCodeAt(0), '1'.charCodeAt(0))
  bytes.push(1) // version
  pushU8Str('srp_btn_vs_bb')
  bytes.push(10, 20, 30) // flop card ids
  pushU32(55)
  pushU32(975)

  // combo table: oop=2, ip=3
  pushU16(2)
  bytes.push(0, 1, 2, 3)
  pushU16(3)
  bytes.push(4, 5, 6, 7, 8, 9)

  // node table: 1 node
  pushU16(1)
  pushU8Str('') // nodeId (root)
  bytes.push(0) // player
  bytes.push(2) // actionCount
  pushU8Str('check')
  pushU8Str('bet33')
  pushU32(0) // dataOffset

  // data: freq (action-major, 2 actions x 2 hands) then ev
  bytes.push(128, 255, 128, 0) // freq: 0.5,1.0,0.5,0.0 quantized
  pushI16(123)
  pushI16(-450)
  pushI16(-123)
  pushI16(450)

  return new Uint8Array(bytes).buffer
}

describe('decodeSolutionFile', () => {
  it('Rust側export.rsのround_tripテストと同じバイト列を正しくデコードする', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())

    expect(sol.scenarioId).toBe('srp_btn_vs_bb')
    expect(sol.flopCardIds).toEqual([10, 20, 30])
    expect(sol.startingPotChips).toBe(55)
    expect(sol.effectiveStackChips).toBe(975)
    expect(sol.startingPotBb).toBeCloseTo(5.5, 6)
    expect(sol.effectiveStackBb).toBeCloseTo(97.5, 6)

    expect(sol.oopCombos.length).toBe(2)
    expect(sol.ipCombos.length).toBe(3)

    const rootNode = sol.nodes.get('')
    expect(rootNode).toBeDefined()
    expect(rootNode?.player).toBe(0)
    expect(rootNode?.actionLabels).toEqual(['check', 'bet33'])
    // freq: 128/255≈0.502, 255/255=1.0, 128/255≈0.502, 0/255=0.0
    expect(rootNode?.freqs[0]).toBeCloseTo(128 / 255, 4)
    expect(rootNode?.freqs[1]).toBeCloseTo(1.0, 4)
    expect(rootNode?.freqs[2]).toBeCloseTo(128 / 255, 4)
    expect(rootNode?.freqs[3]).toBeCloseTo(0.0, 4)
    // ev: 0.01bb単位
    expect(rootNode?.evsBb[0]).toBeCloseTo(1.23, 4)
    expect(rootNode?.evsBb[1]).toBeCloseTo(-4.5, 4)
    expect(rootNode?.evsBb[2]).toBeCloseTo(-1.23, 4)
    expect(rootNode?.evsBb[3]).toBeCloseTo(4.5, 4)
  })

  it('cardFromRustId: rust形式card_id(4*rank+suit)をTS Cardへ正しく変換する', () => {
    // card_from_str("2c")=0, "3d"=5, "4h"=10, "As"=51 (postflop-solverのdoc例に準拠)
    expect(cardKey(cardFromRustId(0))).toBe('2c')
    expect(cardKey(cardFromRustId(5))).toBe('3d')
    expect(cardKey(cardFromRustId(10))).toBe('4h')
    expect(cardKey(cardFromRustId(51))).toBe('14s')
  })

  it('無効なmagicバイトはエラーになる', () => {
    const bad = new Uint8Array([88, 88, 88, 88, 1]).buffer
    expect(() => decodeSolutionFile(bad)).toThrow(/magic/)
  })
})
