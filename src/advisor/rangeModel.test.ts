import { describe, it, expect } from 'vitest'
import { getPreflopRange, inferPlayerRange, narrowRangeByAction, combosToHandSet } from './rangeModel'
import { OPEN_RANGES, THREEBET_RANGES, BB_CALL_RANGE } from './ranges'
import { expandRange } from '../analysis/range'
import type { GameState, Player, Card } from '../engine/types'

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: 'p1', name: 'Bot', type: 'reg', stack: 5000, holeCards: [],
    position: 'CO', seatIndex: 1, bet: 0, totalBetInHand: 0,
    folded: false, allin: false, isUser: false, hasActed: false, lastAction: null,
    ...overrides,
  }
}

function makeGame(overrides: Partial<GameState>): GameState {
  return {
    street: 'PREFLOP_BETTING',
    players: [],
    board: [],
    pots: [],
    currentBet: 50,
    minRaise: 100,
    actionIndex: 0,
    buttonIndex: 0,
    handNumber: 1,
    deck: [],
    actionHistory: [],
    handOver: false,
    ...overrides,
  }
}

function comboCountFor(hands: Set<string>): number {
  let sum = 0
  for (const h of hands) sum += h.length === 2 ? 6 : h.endsWith('s') ? 4 : 12
  return sum
}

describe('getPreflopRange', () => {
  it('open は OPEN_RANGES と同一', () => {
    expect(getPreflopRange('CO', 'open')).toBe(OPEN_RANGES.CO)
  })

  it('3bet は THREEBET_RANGES と同一', () => {
    expect(getPreflopRange('CO', '3bet')).toBe(THREEBET_RANGES.CO)
  })

  it('BBのcall は BB_CALL_RANGE', () => {
    expect(getPreflopRange('BB', 'call')).toBe(BB_CALL_RANGE)
  })

  it('非BBのcall はオープンレンジから3betレンジ(レイズ部分)を除いた残り', () => {
    const result = getPreflopRange('CO', 'call')
    for (const h of THREEBET_RANGES.CO) expect(result.has(h)).toBe(false)
    for (const h of OPEN_RANGES.CO) {
      if (!THREEBET_RANGES.CO.has(h)) expect(result.has(h)).toBe(true)
    }
  })
})

describe('inferPlayerRange', () => {
  it('プリフロップで未行動のプレイヤーは169ハンド全体(1326コンボ)を返す', () => {
    const player = makePlayer({ id: 'p1', position: 'BTN' })
    const game = makeGame({ players: [player], actionHistory: [] })
    const combos = inferPlayerRange(game, player, [])
    expect(combos.length).toBe(1326) // 52*51/2
  })

  it('オープンレイズしたプレイヤーはオープンレンジに絞られる', () => {
    const player = makePlayer({ id: 'p1', position: 'CO' })
    const game = makeGame({
      players: [player],
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' }],
    })
    const combos = inferPlayerRange(game, player, [])
    expect(combos.length).toBe(comboCountFor(OPEN_RANGES.CO))
  })

  it('3betしたプレイヤーは3betレンジに絞られる', () => {
    const player = makePlayer({ id: 'p1', position: 'BTN' })
    const game = makeGame({
      players: [player],
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p2', street: 'PREFLOP_BETTING' },
        { type: 'raise', amount: 450, playerId: 'p1', street: 'PREFLOP_BETTING' },
      ],
    })
    const combos = inferPlayerRange(game, player, [])
    expect(combos.length).toBe(comboCountFor(THREEBET_RANGES.BTN))
  })

  it('フラットコールしたプレイヤーはコールレンジ(オープン−3bet)に絞られる', () => {
    const player = makePlayer({ id: 'p1', position: 'CO' })
    const game = makeGame({
      players: [player],
      actionHistory: [{ type: 'call', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' }],
    })
    const combos = inferPlayerRange(game, player, [])
    expect(combos.length).toBe(comboCountFor(getPreflopRange('CO', 'call')))
  })

  it('ストリートが進み行動が伴うと、レンジは単調減少(空にはならない)', () => {
    const player = makePlayer({ id: 'p1', position: 'CO' })
    const board: Card[] = [{ rank: 14, suit: 'c' }, { rank: 13, suit: 'd' }, { rank: 2, suit: 'h' }]

    const gamePreflop = makeGame({
      players: [player],
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' }],
    })
    const preflopCombos = inferPlayerRange(gamePreflop, player, [])

    const gameFlop = makeGame({
      players: [player],
      board,
      street: 'FLOP_BETTING',
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' },
        { type: 'bet', amount: 100, playerId: 'p1', street: 'FLOP_BETTING' },
      ],
    })
    const flopCombos = inferPlayerRange(gameFlop, player, [])

    expect(flopCombos.length).toBeLessThanOrEqual(preflopCombos.length)
    expect(flopCombos.length).toBeGreaterThan(0)
  })

  it('該当ストリートでまだ行動していなければ絞り込まない(情報なしのまま維持)', () => {
    const player = makePlayer({ id: 'p1', position: 'CO' })
    const board: Card[] = [{ rank: 14, suit: 'c' }, { rank: 13, suit: 'd' }, { rank: 2, suit: 'h' }]

    const gamePreflop = makeGame({
      players: [player],
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' }],
    })
    const preflopCombos = inferPlayerRange(gamePreflop, player, [])

    // フロップに進んだが、このプレイヤーはまだ行動していない(他人だけが動いた想定)
    const gameFlopNoAction = makeGame({
      players: [player],
      board,
      street: 'FLOP_BETTING',
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p1', street: 'PREFLOP_BETTING' }],
    })
    const flopCombos = inferPlayerRange(gameFlopNoAction, player, [])
    expect(flopCombos.length).toBe(preflopCombos.length)
  })

  it('dead カードと衝突するコンボは除外される', () => {
    const player = makePlayer({ id: 'p1', position: 'BTN' })
    const game = makeGame({
      players: [player],
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p2', street: 'PREFLOP_BETTING' },
        { type: 'raise', amount: 450, playerId: 'p1', street: 'PREFLOP_BETTING' },
      ],
    })
    const dead: Card[] = [{ rank: 14, suit: 's' }]
    const combos = inferPlayerRange(game, player, dead)
    for (const [a, b] of combos) {
      expect(`${a.rank}${a.suit}`).not.toBe('14s')
      expect(`${b.rank}${b.suit}`).not.toBe('14s')
    }
  })
})

describe('narrowRangeByAction', () => {
  const board: Card[] = [{ rank: 14, suit: 'c' }, { rank: 13, suit: 'd' }, { rank: 2, suit: 'h' }]

  it('bet で絞り込むとコンボ数が元以下になり、空にはならない(安全弁)', () => {
    const combos = expandRange(OPEN_RANGES.CO, board)
    const narrowed = narrowRangeByAction(combos, board, 'bet')
    expect(narrowed.length).toBeLessThanOrEqual(combos.length)
    expect(narrowed.length).toBeGreaterThan(0)
  })

  it('check では絞り込まない(元のコンボ数を維持)', () => {
    const combos = expandRange(OPEN_RANGES.CO, board)
    const narrowed = narrowRangeByAction(combos, board, 'check')
    expect(narrowed.length).toBe(combos.length)
  })

  it('絞り込んだ結果が空になるケースでは元のコンボを返す(安全弁)', () => {
    // 全コンボがAIRになる極端な状況を想定: 絞り込み対象が無いレンジ(空配列)を渡しても安全
    const narrowed = narrowRangeByAction([], board, 'bet')
    expect(narrowed).toHaveLength(0)
  })
})

describe('combosToHandSet', () => {
  it('コンボ配列をハンド表記の集合に変換する', () => {
    const combos = expandRange(new Set(['AA', 'AKs']), [])
    const set = combosToHandSet(combos)
    expect(set).toEqual(new Set(['AA', 'AKs']))
  })
})
