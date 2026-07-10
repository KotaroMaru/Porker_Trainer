// P4 Step 1: TSのCombo(Card配列)とRust形式card_id(FORMAT.mdセクション1)の相互変換、
// およびDecodedSolutionのコンボ表(oopCombos/ipCombos)に対するコンボ→インデックス検索。
// crossvalidationテスト(P3 Step5)で検証済みのロジックをここに昇格して共通化する。

import type { Card, Suit } from '../../engine/types'
import type { Combo } from '../../analysis/range'

const RUST_SUITS: Suit[] = ['c', 'd', 'h', 's']

/** TSのCardをrust形式card_id(0..51)に変換する(binaryFormat.tsのcardFromRustIdの逆)。 */
export function rustIdFromCard(card: Card): number {
  const suitIndex = RUST_SUITS.indexOf(card.suit)
  return 4 * (card.rank - 2) + suitIndex
}

/** コンボ(2枚)を、順序に依存しないrust IDペアの文字列キーに変換する。 */
export function comboRustKey(combo: Combo): string {
  const [a, b] = [rustIdFromCard(combo[0]), rustIdFromCard(combo[1])].sort((x, y) => x - y)
  return `${a},${b}`
}

/**
 * rust card_idペアの配列(JSONデバッグフィクスチャ等、変換前の生データ)から、
 * 「rust IDキー→配列インデックス」の検索用Mapを構築する。
 */
export function buildComboIndexMap(rustCombos: readonly (readonly [number, number])[]): Map<string, number> {
  const map = new Map<string, number>()
  rustCombos.forEach(([a, b], i) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    map.set(key, i)
  })
  return map
}

/**
 * DecodedSolutionのコンボ表(loader/binaryFormat.tsで既にrust ID→TS Card変換済みの
 * Combo[])から、「rust IDキー→配列インデックス」の検索用Mapを構築する。
 * 採点・ボットのアクションサンプリングで、手札のComboが解データの何番目の
 * コンボに対応するかを引くために使う。
 */
export function buildComboIndexMapFromCombos(combos: readonly Combo[]): Map<string, number> {
  const map = new Map<string, number>()
  combos.forEach((combo, i) => map.set(comboRustKey(combo), i))
  return map
}

/** comboIndexMapからTSのComboに対応するインデックスを引く。見つからなければエラー。 */
export function lookupComboIndex(indexMap: Map<string, number>, combo: Combo): number {
  const idx = indexMap.get(comboRustKey(combo))
  if (idx === undefined) {
    throw new Error(`combo not found in solution combo table: ${combo.map((c) => `${c.rank}${c.suit}`).join('')}`)
  }
  return idx
}
