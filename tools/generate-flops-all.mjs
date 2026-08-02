#!/usr/bin/env node
// 52枚から3枚を選ぶ全22,100通りをスート同型でまとめ、完全なフロップ定義を生成する。
// 同型判定は簡易的な初出順ラベルではなく、4!通りすべてのスート置換の最小キーを使う。
//
// 実行: node tools/generate-flops-all.mjs
// 出力: src/gto/data/flopsAll.json

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(scriptDirectory, '..')
const existingFlopsPath = join(projectRoot, 'src/gto/data/flops.json')
const outputPath = join(projectRoot, 'src/gto/data/flopsAll.json')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['c', 'd', 'h', 's']
const TOTAL_FLOPS = 22_100

function permutations(values) {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map((rest) => [value, ...rest]),
  )
}

const SUIT_PERMUTATIONS = permutations(SUITS)
const rankIndex = new Map(RANKS.map((rank, index) => [rank, index]))
const suitIndex = new Map(SUITS.map((suit, index) => [suit, index]))

function compareCards(left, right) {
  return rankIndex.get(left[0]) - rankIndex.get(right[0]) || suitIndex.get(left[1]) - suitIndex.get(right[1])
}

/** 4!通りのスート置換後のうち、ランク降順・スート順で並べた辞書順最小キーを返す。 */
export function canonicalFlopKey(cards) {
  let best = null

  for (const permutation of SUIT_PERMUTATIONS) {
    const suitMap = new Map(SUITS.map((suit, index) => [suit, permutation[index]]))
    const representative = cards
      .map((card) => `${card[0]}${suitMap.get(card[1])}`)
      .sort(compareCards)
      .join(',')
    if (best === null || representative < best) best = representative
  }

  return best
}

function textureOf(cards) {
  const ranks = cards.map((card) => card[0])
  const suitCount = new Set(cards.map((card) => card[1])).size
  return {
    paired: new Set(ranks).size < ranks.length,
    monotone: suitCount === 1,
    twoTone: suitCount === 2,
    // 既存flops.json・FlopDefの定義どおり、T/J/Q/K/Aをハイカードとして数える。
    highCardCount: ranks.filter((rank) => rankIndex.get(rank) <= rankIndex.get('T')).length,
  }
}

export function generateAllFlops(existingFlops) {
  const deck = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`))
  const classes = new Map()

  for (let first = 0; first < deck.length - 2; first++) {
    for (let second = first + 1; second < deck.length - 1; second++) {
      for (let third = second + 1; third < deck.length; third++) {
        const key = canonicalFlopKey([deck[first], deck[second], deck[third]])
        const current = classes.get(key)
        if (current) current.count++
        else classes.set(key, { cards: key.split(','), count: 1 })
      }
    }
  }

  // 既存95件はすべて別クラスだが、88件は最小スート表記ではない。段階Aで既存シナリオとの
  // 文字列互換性も検証できるよう、該当クラスだけ同型な既存表記を出力代表として維持する。
  const existingRepresentativeByKey = new Map()
  for (const flop of existingFlops) {
    const key = canonicalFlopKey(flop.cards)
    if (!classes.has(key)) throw new Error(`既存フロップの同型クラスが見つかりません: ${flop.cards.join(',')}`)
    if (existingRepresentativeByKey.has(key)) {
      throw new Error(`既存flops.jsonに同じスート同型クラスが重複しています: ${key}`)
    }
    existingRepresentativeByKey.set(key, flop.cards)
  }

  return [...classes.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, flopClass]) => {
      const cards = existingRepresentativeByKey.get(key) ?? flopClass.cards
      return {
        cards,
        texture: textureOf(cards),
        weight: flopClass.count / TOTAL_FLOPS,
      }
    })
}

function main() {
  const existingFlops = JSON.parse(readFileSync(existingFlopsPath, 'utf8'))
  const flops = generateAllFlops(existingFlops)
  writeFileSync(outputPath, `${JSON.stringify(flops, null, 2)}\n`)
  console.log(`生成完了: ${flops.length}同型フロップ → ${outputPath}`)
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
