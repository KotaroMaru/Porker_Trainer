import type { Card } from '../engine/types'
import { evaluate } from '../engine/evaluator'
import type { Combo } from './range'

export interface EquityResult {
  equity: number
  wins: number
  ties: number
  total: number
}

const ALL_RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14] as const
const ALL_SUITS = ['c','d','h','s'] as const

function buildDeck(exclude: Card[]): Card[] {
  const excludeSet = new Set(exclude.map(c => `${c.rank}${c.suit}`))
  const deck: Card[] = []
  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      if (!excludeSet.has(`${rank}${suit}`)) {
        deck.push({ rank, suit })
      }
    }
  }
  return deck
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

/**
 * Monte Carlo equity: hero's win probability against known villain hole cards.
 * Villain cards can be provided or left as [] to skip that villain.
 */
export function calculateEquity(
  heroCards: Card[],
  villainCards: Card[][],
  board: Card[],
  iterations = 10000,
): EquityResult {
  if (villainCards.length === 0) return { equity: 1, wins: iterations, ties: 0, total: iterations }

  let wins = 0
  let ties = 0
  const total = iterations

  const known = [...heroCards, ...board, ...villainCards.flat()]

  for (let i = 0; i < iterations; i++) {
    const deck = fisherYates(buildDeck(known))
    let di = 0

    // Fill villain hands if not known
    const villainHands = villainCards.map(vc => {
      if (vc.length === 2) return vc
      const hand: Card[] = []
      while (hand.length < 2) hand.push(deck[di++])
      return hand
    })

    // Complete board
    const neededBoard = 5 - board.length
    const runoutBoard = [...board]
    for (let b = 0; b < neededBoard; b++) runoutBoard.push(deck[di++])

    const heroScore = evaluate([...heroCards, ...runoutBoard]).score
    const villainScores = villainHands.map(vh => evaluate([...vh, ...runoutBoard]).score)
    const maxVillain = Math.max(...villainScores)

    if (heroScore > maxVillain) {
      wins++
    } else if (heroScore === maxVillain) {
      ties++
    }
  }

  const equity = (wins + ties * 0.5) / total
  return { equity, wins, ties, total }
}

/**
 * Exact enumeration for river (0 remaining) or turn (1 remaining).
 * Falls back to Monte Carlo for earlier streets.
 */
export function calculateEquityExact(
  heroCards: Card[],
  villainCards: Card[][],
  board: Card[],
): EquityResult {
  const remaining = 5 - board.length

  if (remaining === 0) {
    // River: no runout needed
    if (villainCards.length === 0) return { equity: 1, wins: 1, ties: 0, total: 1 }
    const heroScore = evaluate([...heroCards, ...board]).score
    const villainScores = villainCards.map(vc => evaluate([...vc, ...board]).score)
    const maxVillain = Math.max(...villainScores)
    if (heroScore > maxVillain) return { equity: 1, wins: 1, ties: 0, total: 1 }
    if (heroScore === maxVillain) return { equity: 0.5, wins: 0, ties: 1, total: 1 }
    return { equity: 0, wins: 0, ties: 0, total: 1 }
  }

  if (remaining === 1) {
    // Turn: enumerate all possible river cards
    const known = [...heroCards, ...board, ...villainCards.flat()]
    const deck = buildDeck(known)
    let wins = 0
    let ties = 0
    const total = deck.length

    for (const river of deck) {
      const runout = [...board, river]
      const heroScore = evaluate([...heroCards, ...runout]).score
      const villainScores = villainCards.map(vc => evaluate([...vc, ...runout]).score)
      const maxVillain = villainScores.length > 0 ? Math.max(...villainScores) : -1
      if (heroScore > maxVillain) wins++
      else if (heroScore === maxVillain) ties++
    }

    const equity = (wins + ties * 0.5) / total
    return { equity, wins, ties, total }
  }

  if (remaining === 2) {
    // Flop: enumerate all turn+river combinations
    const known = [...heroCards, ...board, ...villainCards.flat()]
    const deck = buildDeck(known)
    const runouts = combinations(deck, 2)
    let wins = 0
    let ties = 0
    const total = runouts.length

    for (const [t, r] of runouts) {
      const runout = [...board, t, r]
      const heroScore = evaluate([...heroCards, ...runout]).score
      const villainScores = villainCards.map(vc => evaluate([...vc, ...runout]).score)
      const maxVillain = villainScores.length > 0 ? Math.max(...villainScores) : -1
      if (heroScore > maxVillain) wins++
      else if (heroScore === maxVillain) ties++
    }

    const equity = (wins + ties * 0.5) / total
    return { equity, wins, ties, total }
  }

  // Preflop or earlier: fall back to MC
  return calculateEquity(heroCards, villainCards, board, 10000)
}

function comboKey(c: Card): string {
  return `${c.rank}${c.suit}`
}

// レンジ(コンボ配列)からusedKeysと衝突しない1コンボを再抽選付きで選ぶ。尽きたらnull。
function pickComboAvoiding(combos: Combo[], usedKeys: Set<string>, maxAttempts = 60): Combo | null {
  if (combos.length === 0) return null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const combo = combos[Math.floor(Math.random() * combos.length)]
    const k1 = comboKey(combo[0])
    const k2 = comboKey(combo[1])
    if (k1 === k2) continue
    if (!usedKeys.has(k1) && !usedKeys.has(k2)) return combo
  }
  return null
}

export interface RangeEquityOptions {
  heroFixed?: Card[]       // 指定時はヒーローの手を固定(実手札)
  heroRange?: Combo[]      // 未指定の場合はこのレンジからランダム抽選(レンジ平均用)
  villainRanges: Combo[][] // 各相手のレンジ(コンボ配列)
  board: Card[]
  iterations?: number
}

/**
 * レンジ対レンジ(またはヒーロー固定 vs レンジ)のMonte Carlo勝率。
 * 各イテレーションで衝突しないコンボを再抽選しながら抽出し、残りのボードを完成させて評価する。
 * レンジが枯渇した(再抽選上限超え)イテレーションはスキップされ、totalには数えない。
 */
export function monteCarloRangeEquity(opts: RangeEquityOptions): EquityResult {
  const { heroFixed, heroRange, villainRanges, board, iterations = 2500 } = opts
  let wins = 0
  let ties = 0
  let total = 0

  for (let i = 0; i < iterations; i++) {
    const usedKeys = new Set(board.map(comboKey))
    const knownCards: Card[] = [...board]

    let heroCards: Card[] | null = null
    if (heroFixed && heroFixed.length === 2) {
      heroCards = heroFixed
    } else if (heroRange && heroRange.length > 0) {
      const combo = pickComboAvoiding(heroRange, usedKeys)
      if (combo) heroCards = combo
    }
    if (!heroCards) continue
    for (const c of heroCards) { usedKeys.add(comboKey(c)); knownCards.push(c) }

    const villainHands: Card[][] = []
    let failed = false
    for (const range of villainRanges) {
      const combo = pickComboAvoiding(range, usedKeys)
      if (!combo) { failed = true; break }
      for (const c of combo) { usedKeys.add(comboKey(c)); knownCards.push(c) }
      villainHands.push(combo)
    }
    if (failed) continue

    const neededBoard = 5 - board.length
    const deck = fisherYates(buildDeck(knownCards))
    const runoutBoard = [...board, ...deck.slice(0, neededBoard)]

    const heroScore = evaluate([...heroCards, ...runoutBoard]).score
    const villainScores = villainHands.map(vh => evaluate([...vh, ...runoutBoard]).score)
    const maxVillain = villainScores.length > 0 ? Math.max(...villainScores) : -1

    total++
    if (heroScore > maxVillain) wins++
    else if (heroScore === maxVillain) ties++
  }

  if (total === 0) return { equity: 0.5, wins: 0, ties: 0, total: 0 }
  const equity = (wins + ties * 0.5) / total
  return { equity, wins, ties, total }
}
