#!/usr/bin/env node
// 代表フロップ95種の生成スクリプト。
//
// 方針: 52枚から3枚を選ぶ全22100通りのフロップを、スート構成(モノトーン/ツートーン/
// レインボー/ペア/トリップス)で分類したときの「実際の出現確率」(組み合わせ論から
// 厳密に導出可能)をカテゴリ重みとして採用し、各カテゴリ内でランクの高低・連結性の
// バリエーションを代表する具体的なフロップをシード付き乱数で選ぶ。
// カテゴリ内は一様重みとする単純化(「近似」データである点はP3で本物のソルバー
// 事前計算に置き換わるまでの前提と同じ)。トリップスは実出現率(0.24%)だと
// 練習機会が事実上ゼロになるため、意図的に多めに配分している。
//
// 実際の出現率(全22100通り中):
//   モノトーン 5.18% / レインボー 31.06% / ツートーン 46.59% / ペア 16.95% / トリップス 0.24%
//
// 実行: node tools/gen-flops.mjs
// 出力: src/gto/data/flops.json

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', 'src/gto/data/flops.json')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['c', 'd', 'h', 's']

function bucketOf(rankIdx) {
  if (rankIdx <= 4) return 'high' // A,K,Q,J,T
  if (rankIdx <= 8) return 'mid' // 9,8,7,6
  return 'low' // 5,4,3,2
}

// mulberry32: シンプルな決定論的PRNG(再現性のため固定シード使用)
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20260704)
function pick(arr) {
  return arr[Math.floor(rng() * arr.length)]
}
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const HEIGHT_PATTERNS = [
  ['high', 'high', 'high'], ['high', 'high', 'mid'], ['high', 'high', 'low'],
  ['high', 'mid', 'mid'], ['high', 'mid', 'low'], ['high', 'low', 'low'],
  ['mid', 'mid', 'mid'], ['mid', 'mid', 'low'], ['mid', 'low', 'low'],
  ['low', 'low', 'low'],
]

function ranksInBucket(bucket) {
  return RANKS.map((r, i) => ({ r, i })).filter((x) => bucketOf(x.i) === bucket).map((x) => x.i)
}

function pickDistinctRanksForPattern(pattern, used) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const idxs = new Set()
    let ok = true
    for (const bucket of pattern) {
      const pool = ranksInBucket(bucket).filter((i) => !idxs.has(i))
      if (pool.length === 0) { ok = false; break }
      idxs.add(pick(pool))
    }
    if (!ok) continue
    const arr = [...idxs].sort((a, b) => a - b)
    const key = arr.join(',')
    if (used.has(key)) continue
    used.add(key)
    return arr
  }
  return null
}

function cardStr(rankIdx, suit) {
  return `${RANKS[rankIdx]}${suit}`
}

function highCardCount(rankIdxs) {
  return rankIdxs.filter((i) => i <= 4).length // A,K,Q,J,T
}

const flops = []
const usedFlopKeys = new Set()

function addFlop(cardTriplet, texture, weight) {
  const key = [...cardTriplet].sort().join(',')
  if (usedFlopKeys.has(key)) return false
  usedFlopKeys.add(key)
  flops.push({ cards: cardTriplet, texture, weight })
  return true
}

// ---- モノトーン (7枚, カテゴリ重み合計 0.0518) ----
{
  const usedRanks = new Set()
  const count = 7
  const catWeight = 0.0518
  let added = 0
  let tries = 0
  while (added < count && tries < 200) {
    tries++
    const pattern = HEIGHT_PATTERNS[added % HEIGHT_PATTERNS.length]
    const idxs = pickDistinctRanksForPattern(pattern, usedRanks)
    if (!idxs) continue
    const suit = pick(SUITS)
    const cards = idxs.map((i) => cardStr(i, suit))
    const ok = addFlop(cards, { paired: false, monotone: true, twoTone: false, highCardCount: highCardCount(idxs) }, catWeight / count)
    if (ok) added++
  }
}

// ---- レインボー (30枚, カテゴリ重み合計 0.3106) ----
{
  const usedRanks = new Set()
  const count = 30
  const catWeight = 0.3106
  let added = 0
  let tries = 0
  while (added < count && tries < 400) {
    tries++
    const pattern = HEIGHT_PATTERNS[added % HEIGHT_PATTERNS.length]
    const idxs = pickDistinctRanksForPattern(pattern, usedRanks)
    if (!idxs) continue
    const suits = shuffle(SUITS).slice(0, 3)
    const cards = idxs.map((i, k) => cardStr(i, suits[k]))
    const ok = addFlop(cards, { paired: false, monotone: false, twoTone: false, highCardCount: highCardCount(idxs) }, catWeight / count)
    if (ok) added++
  }
}

// ---- ツートーン (40枚, カテゴリ重み合計 0.4659) ----
{
  const usedRanks = new Set()
  const count = 40
  const catWeight = 0.4659
  let added = 0
  let tries = 0
  while (added < count && tries < 400) {
    tries++
    const pattern = HEIGHT_PATTERNS[added % HEIGHT_PATTERNS.length]
    const idxs = pickDistinctRanksForPattern(pattern, usedRanks)
    if (!idxs) continue
    const pairSuit = pick(SUITS)
    const otherSuit = pick(SUITS.filter((s) => s !== pairSuit))
    const suitedPositions = shuffle([0, 1, 2]).slice(0, 2)
    const suits = [otherSuit, otherSuit, otherSuit]
    for (const p of suitedPositions) suits[p] = pairSuit
    const cards = idxs.map((i, k) => cardStr(i, suits[k]))
    const ok = addFlop(cards, { paired: false, monotone: false, twoTone: true, highCardCount: highCardCount(idxs) }, catWeight / count)
    if (ok) added++
  }
}

// ---- ペア (15枚, カテゴリ重み合計 0.1695) ----
{
  const usedCombos = new Set()
  const count = 15
  const catWeight = 0.1695
  let added = 0
  let tries = 0
  const heightBuckets = ['high', 'mid', 'low']
  while (added < count && tries < 300) {
    tries++
    const pairBucket = heightBuckets[added % 3]
    const pairPool = ranksInBucket(pairBucket)
    const pairIdx = pick(pairPool)
    const kickerPool = RANKS.map((_, i) => i).filter((i) => i !== pairIdx)
    const kickerIdx = pick(kickerPool)
    const key = `${pairIdx}-${kickerIdx}`
    if (usedCombos.has(key)) continue
    usedCombos.add(key)
    const pairSuits = shuffle(SUITS).slice(0, 2)
    const kickerSuit = pick(SUITS)
    const cards = [cardStr(pairIdx, pairSuits[0]), cardStr(pairIdx, pairSuits[1]), cardStr(kickerIdx, kickerSuit)]
    const ok = addFlop(cards, { paired: true, monotone: false, twoTone: false, highCardCount: highCardCount([pairIdx, pairIdx, kickerIdx]) }, catWeight / count)
    if (ok) added++
  }
}

// ---- トリップス (3枚, カテゴリ重み合計 0.024 ※実際の0.0024より意図的に多め) ----
{
  const usedRanks = new Set()
  const count = 3
  const catWeight = 0.024
  const targetIdxs = [1, 6, 11] // K, 7, 3 (高/中/低から1つずつ代表)
  for (const idx of targetIdxs) {
    if (usedRanks.has(idx)) continue
    usedRanks.add(idx)
    const suits = shuffle(SUITS).slice(0, 3)
    const cards = suits.map((s) => cardStr(idx, s))
    addFlop(cards, { paired: true, monotone: false, twoTone: false, highCardCount: highCardCount([idx, idx, idx]) }, catWeight / count)
  }
}

// 重み合計を1に正規化(カテゴリ重みの丸め誤差を吸収)
const weightSum = flops.reduce((s, f) => s + f.weight, 0)
for (const f of flops) f.weight = Math.round((f.weight / weightSum) * 100000) / 100000

writeFileSync(OUT_PATH, JSON.stringify(flops, null, 2) + '\n')

console.log(`生成完了: ${flops.length}フロップ → ${OUT_PATH}`)
const byTexture = { monotone: 0, twoTone: 0, rainbow: 0, paired: 0, trips: 0 }
for (const f of flops) {
  if (f.texture.paired && new Set(f.cards.map((c) => c[0])).size === 1) byTexture.trips += f.weight
  else if (f.texture.paired) byTexture.paired += f.weight
  else if (f.texture.monotone) byTexture.monotone += f.weight
  else if (f.texture.twoTone) byTexture.twoTone += f.weight
  else byTexture.rainbow += f.weight
}
console.log('カテゴリ別重み合計:', byTexture)
