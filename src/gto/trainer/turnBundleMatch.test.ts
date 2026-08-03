// P15: ターンバンドルとアプリ側コンボ表の照合が実データで成立することを恒久的に検査する。
//
// なぜ必要か: fullHandFlowはバンドルのコンボ表がアプリ側の期待と一致しない場合、
// 数値破綻を避けるため**黙って**ライブソルブへ退避する。この退避は正常系として
// 実装されているので、照合が常に失敗していても「バッジが『計算』になる」だけで
// エラーにならず、型にも既存テストにも現れない。実際にこれが起きていた:
// Rust側は到達確率0のコンボも保持するのに、TS側はfilterAndRenormalizeで落として
// いたため、**49ターン中0件しか一致せず**バンドルが一度も使われていなかった。
//
// 生成物の形式が変わったときに同じ事故を再発させないよう、実データで突き合わせる。
//
// フィクスチャ(約3.8MB)の再生成:
//   curl -sL -o src/gto/trainer/__fixtures__/AsJs6s-check-check.bin \
//     "https://huggingface.co/datasets/Kota903/poker-trainer-gto-turn/resolve/main/srp_btn_vs_bb/AsJs6s/check-check.bin"
// テスト内でネットワークへ出ないよう、あえてリポジトリへ置いている。

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeSolutionFile } from '../loader/binaryFormat'
import { decodeBundleIndex, decodeBundleTurn } from '../loader/bundleFormat'
import { excludeDeadCardOnly } from './fullHandFlow'
import { cardKey } from '../../engine/deck'
import type { Combo } from '../../analysis/range'

const FLOP_ID = 'AsJs6s'
const FLOP_BIN = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', `${FLOP_ID}.bin`)
// ネットワークを使わないよう、リポジトリ内に置いたバンドルのフィクスチャを使う。
const BUNDLE_FIXTURE = join(process.cwd(), 'src/gto/trainer/__fixtures__', `${FLOP_ID}-check-check.bin`)

function toArrayBuffer(path: string): ArrayBuffer {
  const b = readFileSync(path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function comboKeys(combos: readonly Combo[]): string[] {
  return combos.map((c) => cardKey(c[0]) + cardKey(c[1]))
}

const hasFixtures = existsSync(FLOP_BIN) && existsSync(BUNDLE_FIXTURE)

describe.skipIf(!hasFixtures)('ターンバンドルとアプリ側コンボ表の照合(実データ)', () => {
  it('全49ターンで、デッドカードのみ除いたコンボ表がバンドルと順序まで一致する', () => {
    const flopSol = decodeSolutionFile(toArrayBuffer(FLOP_BIN))
    const bundle = toArrayBuffer(BUNDLE_FIXTURE)
    const index = decodeBundleIndex(bundle)
    expect(index.entries.size).toBe(49)

    for (const [turnKey, entry] of index.entries) {
      const sol = decodeBundleTurn(bundle, entry)
      expect(comboKeys(sol.oopCombos), `oop turn=${turnKey}`).toEqual(comboKeys(excludeDeadCardOnly(flopSol.oopCombos, turnKey)))
      expect(comboKeys(sol.ipCombos), `ip turn=${turnKey}`).toEqual(comboKeys(excludeDeadCardOnly(flopSol.ipCombos, turnKey)))
    }
  })

  it('バンドルは到達確率0のコンボも保持する(経路によってコンボ数が変わらない)', () => {
    // この性質が崩れたら excludeDeadCardOnly での照合は成立しなくなる。
    // 生成側(Rust)の仕様変更を検出するための検査。
    const bundle = toArrayBuffer(BUNDLE_FIXTURE)
    const index = decodeBundleIndex(bundle)
    const flopSol = decodeSolutionFile(toArrayBuffer(FLOP_BIN))

    for (const [turnKey, entry] of index.entries) {
      const sol = decodeBundleTurn(bundle, entry)
      // デッドカードで除かれる分を除けば、フロップ解のコンボ数と一致する。
      expect(sol.oopCombos.length, `turn=${turnKey}`).toBe(excludeDeadCardOnly(flopSol.oopCombos, turnKey).length)
    }
  })
})
