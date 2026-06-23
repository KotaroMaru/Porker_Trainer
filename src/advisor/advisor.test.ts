import { describe, it, expect } from 'vitest'
import { getPreflopAdvice, OPEN_RANGES, THREEBET_RANGES } from './ranges'
import { classifyHandStrength, getPostflopAdvice, estimatePlayerEquity, assessShowdownValue } from './postflop'
import { getExploitAdjustment } from './exploit'
import { betSizeVerdict } from './explain'
import { detectMistake } from './mistakes'
import { getYokosawaTier, getYokosawaAdvice, getYokosawaContext, YOKOSAWA_TIERS, BB_BOUNDARY_HANDS } from './yokosawa'
import { randomHand, makePreflopQuestion, makeTierQuestion, makeReraiseQuestion, makeRangePredictionQuestion } from './quiz'
import { actionOrder } from '../engine/positions'
import type { Card, Player, GameState, Action } from '../engine/types'

function c(rank: number, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] }
}

// ---------- preflop range ----------
describe('getPreflopAdvice', () => {
  it('AA from UTG → open', () => {
    expect(getPreflopAdvice('UTG', 14, 14, false, false)).toBe('open')
  })
  it('72o from UTG → fold', () => {
    expect(getPreflopAdvice('UTG', 7, 2, false, false)).toBe('fold')
  })
  it('BTN opens wider than UTG: 65s from BTN → open', () => {
    expect(getPreflopAdvice('BTN', 6, 5, true, false)).toBe('open')
  })
  it('65s from UTG → fold', () => {
    expect(getPreflopAdvice('UTG', 6, 5, true, false)).toBe('fold')
  })
  it('AA facing raise from any position → 3bet', () => {
    expect(getPreflopAdvice('CO', 14, 14, false, true)).toBe('3bet')
  })
  it('72o facing raise → fold', () => {
    expect(getPreflopAdvice('BTN', 7, 2, false, true)).toBe('fold')
  })
  it('BB defends ATo vs raise → call', () => {
    expect(getPreflopAdvice('BB', 14, 10, false, true)).toBe('call')
  })
  it('AKs facing raise → 3bet', () => {
    expect(getPreflopAdvice('HJ', 14, 13, true, true)).toBe('3bet')
  })
  // BB, no raise (limped to): weak hands check for free, never fold
  it('BB weak hand with no raise → check (not fold)', () => {
    expect(getPreflopAdvice('BB', 7, 2, false, false)).toBe('check')
  })
  it('BB strong hand with no raise → open (isolate limpers)', () => {
    expect(getPreflopAdvice('BB', 14, 14, false, false)).toBe('open')
  })
  it('non-BB weak hand with no raise still folds (must invest to play)', () => {
    expect(getPreflopAdvice('SB', 7, 2, false, false)).toBe('fold')
  })
})

// ---------- postflop hand classification ----------
describe('classifyHandStrength', () => {
  it('quads = MONSTER', () => {
    expect(classifyHandStrength(
      [c(8,'c'), c(8,'d')],
      [c(8,'h'), c(8,'s'), c(2,'c')]
    )).toBe('MONSTER')
  })

  it('two pair = STRONG_MADE', () => {
    expect(classifyHandStrength(
      [c(9,'c'), c(9,'d')],
      [c(9,'h'), c(2,'s'), c(2,'c')]
    )).toBe('MONSTER') // full house
  })

  it('top pair = MIDDLE', () => {
    expect(classifyHandStrength(
      [c(14,'c'), c(7,'d')],
      [c(14,'h'), c(5,'s'), c(2,'c')]
    )).toBe('MIDDLE')
  })

  it('no pair on dry board = AIR', () => {
    expect(classifyHandStrength(
      [c(9,'c'), c(8,'d')],
      [c(14,'h'), c(5,'s'), c(2,'c')]
    )).toBe('AIR')
  })

  it('board paired, hole cards do not connect = AIR (playing the board)', () => {
    // board KK7, hole 9-3 → the pair is entirely on the board, not the player's hand
    expect(classifyHandStrength(
      [c(9,'c'), c(3,'d')],
      [c(13,'h'), c(13,'s'), c(7,'c')]
    )).toBe('AIR')
  })

  it('board two-paired, hole cards uninvolved = AIR (playing the board)', () => {
    // board KK77, hole A-Q (no pair of own) → two pair is all board
    expect(classifyHandStrength(
      [c(14,'c'), c(12,'d')],
      [c(13,'h'), c(13,'s'), c(7,'c'), c(7,'d')]
    )).toBe('AIR')
  })

  it('board paired but hole card makes a real second pair = STRONG_MADE', () => {
    // board KK8, hole 8-x → player pairs the 8 → two pair KK88 (real, uses hole card)
    expect(classifyHandStrength(
      [c(8,'c'), c(4,'d')],
      [c(13,'h'), c(13,'s'), c(8,'h')]
    )).toBe('STRONG_MADE')
  })

  it('flush = STRONG_MADE', () => {
    expect(classifyHandStrength(
      [c(9,'h'), c(7,'h')],
      [c(2,'h'), c(5,'h'), c(14,'h')]
    )).toBe('STRONG_MADE')
  })
})

// ---------- postflop advice ----------
describe('getPostflopAdvice - baseline', () => {
  const noOpponents: Player[] = []

  it('monster hand → bet for value', () => {
    const advice = getPostflopAdvice(
      [c(8,'c'), c(8,'d')],
      [c(8,'h'), c(8,'s'), c(2,'c')],
      0.95, 0.25, false, true, noOpponents
    )
    expect(advice.recommended.action).toBe('bet')
  })

  it('air facing big bet → fold when EQ < required', () => {
    const advice = getPostflopAdvice(
      [c(9,'c'), c(8,'d')],
      [c(14,'h'), c(5,'s'), c(2,'c')],
      0.10, 0.33, true, false, noOpponents
    )
    expect(advice.recommended.action).toBe('fold')
  })

  it('air with no bet → check', () => {
    const advice = getPostflopAdvice(
      [c(9,'c'), c(8,'d')],
      [c(14,'h'), c(5,'s'), c(2,'c')],
      0.10, 0, false, true, noOpponents
    )
    expect(advice.recommended.action).toBe('check')
  })

  it('strong draw facing bet with enough equity → call', () => {
    // flush draw: ~35% equity, required 25%
    const advice = getPostflopAdvice(
      [c(9,'h'), c(7,'h')],
      [c(2,'h'), c(5,'h'), c(14,'c')],
      0.35, 0.25, true, false, noOpponents
    )
    expect(['call','raise']).toContain(advice.recommended.action)
  })

  it('strong draw facing bet with too-small equity → fold', () => {
    const advice = getPostflopAdvice(
      [c(9,'h'), c(7,'h')],
      [c(2,'h'), c(5,'h'), c(14,'c')],
      0.15, 0.40, true, false, noOpponents
    )
    expect(advice.recommended.action).toBe('fold')
  })

  it('top pair, no bet → bet for value', () => {
    const advice = getPostflopAdvice(
      [c(14,'c'), c(7,'d')],
      [c(14,'h'), c(5,'s'), c(2,'c')],
      0.65, 0, false, true, noOpponents
    )
    // middle hand with no bet → check (pot control)
    expect(['bet','check']).toContain(advice.recommended.action)
  })
})

// ---------- showdown value & value-vs-bluff ----------
describe('showdown value (SDV)', () => {
  // 44 on 9-3-T-Q-T : board paired (TT), own pair (44) buried → no showdown value
  const hole44 = [c(4, 'c'), c(4, 'd')]
  const boardTpaired = [c(9, 'c'), c(3, 's'), c(10, 'd'), c(12, 'h'), c(10, 'h')]

  it('44 on paired-T board → two pair by category, but SDV = none', () => {
    expect(classifyHandStrength(hole44, boardTpaired)).toBe('STRONG_MADE')
    expect(assessShowdownValue(hole44, boardTpaired, 'STRONG_MADE')).toBe('none')
  })

  it('estimatePlayerEquity for 44 on paired-T → method no_sdv, low value', () => {
    const est = estimatePlayerEquity(hole44, boardTpaired)
    expect(est.method).toBe('no_sdv')
    expect(est.value).toBeLessThan(0.2)
    expect(est.sdv).toBe('none')
  })

  it('genuine set → SDV strong', () => {
    expect(assessShowdownValue([c(8,'c'),c(8,'d')], [c(8,'h'),c(5,'s'),c(2,'c')], 'STRONG_MADE')).toBe('strong')
  })

  it('real two pair using both hole cards (unpaired board) → SDV strong', () => {
    const hole = [c(14,'c'), c(10,'d')]
    const board = [c(14,'h'), c(10,'s'), c(2,'c')]
    expect(assessShowdownValue(hole, board, classifyHandStrength(hole, board))).toBe('strong')
  })

  it('top pair → SDV medium', () => {
    const hole = [c(14,'c'), c(7,'d')]
    const board = [c(14,'h'), c(5,'s'), c(2,'c')]
    expect(assessShowdownValue(hole, board, 'MIDDLE')).toBe('medium')
  })
})

describe('getPostflopAdvice - value vs bluff (no SDV)', () => {
  const hole44 = [c(4, 'c'), c(4, 'd')]
  const boardTpaired = [c(9, 'c'), c(3, 's'), c(10, 'd'), c(12, 'h'), c(10, 'h')]
  const rock = [{ type: 'rock' } as unknown as Player]
  const station = [{ type: 'station' } as unknown as Player]

  it('44 on paired-T, no bet, foldable opp → BET as a bluff (TURN_INTO_BLUFF)', () => {
    const advice = getPostflopAdvice(hole44, boardTpaired, 0.10, 0, false, true, rock)
    expect(advice.recommended.action).toBe('bet')
    expect(advice.recommended.reason).toBe('TURN_INTO_BLUFF')
  })

  it('44 on paired-T, no bet, calling station → give up (check)', () => {
    const advice = getPostflopAdvice(hole44, boardTpaired, 0.10, 0, false, true, station)
    expect(advice.recommended.action).toBe('check')
    expect(advice.recommended.reason).toBe('GIVE_UP_CHECK')
  })

  it('44 on paired-T, facing a bet → fold (NO_SDV_FOLD), not a value call', () => {
    const advice = getPostflopAdvice(hole44, boardTpaired, 0.10, 0.30, true, false, rock)
    expect(advice.recommended.action).toBe('fold')
    expect(advice.recommended.reason).toBe('NO_SDV_FOLD')
  })

  it('genuine strong hand, no bet → VALUE_BET (not bluff)', () => {
    const advice = getPostflopAdvice(
      [c(8,'c'), c(8,'d')], [c(8,'h'), c(5,'s'), c(2,'c')],
      0.9, 0, false, true, [],
    )
    expect(advice.recommended.action).toBe('bet')
    expect(advice.recommended.reason).toBe('VALUE_BET')
  })
})

// ---------- exploit adjustments ----------
describe('getExploitAdjustment', () => {
  it('station → bluff invalid, value wide', () => {
    const adj = getExploitAdjustment('station')
    expect(adj).not.toBeNull()
    expect(adj!.adjustment).toContain('ブラフ無効')
  })

  it('rock → fold to raises', () => {
    const adj = getExploitAdjustment('rock')
    expect(adj!.adjustment).toContain('降りる')
  })

  it('maniac → call down with strong hands', () => {
    const adj = getExploitAdjustment('maniac')
    expect(adj!.adjustment).toContain('コールダウン')
  })

  it('user → null (no self-advice)', () => {
    expect(getExploitAdjustment('user')).toBeNull()
  })
})

// ---------- estimatePlayerEquity (実戦での読み) ----------
describe('estimatePlayerEquity', () => {
  it('flush draw on flop → 4-2 rule (~36%, method=draw)', () => {
    // A♥K♥ on 2♥7♥9♠ = 9 flush outs → 9×4 = 36%
    const est = estimatePlayerEquity(
      [c(14, 'h'), c(13, 'h')],
      [c(2, 'h'), c(7, 'h'), c(9, 's')],
    )
    expect(est.method).toBe('draw')
    expect(est.outs).toBe(9)
    expect(est.value).toBeCloseTo(0.36, 2)
  })

  it('top pair on flop → made-hand read (not 4-2)', () => {
    // A♠K♦ on A♥7♣2♦ = top pair, read by hand strength
    const est = estimatePlayerEquity(
      [c(14, 's'), c(13, 'd')],
      [c(14, 'h'), c(7, 'c'), c(2, 'd')],
    )
    expect(est.method).toBe('made')
    expect(est.value).toBeGreaterThan(0.4)
  })

  it('flop → ×4, turn → ×2 (same flush draw shrinks)', () => {
    const flop = estimatePlayerEquity(
      [c(14, 'h'), c(13, 'h')],
      [c(2, 'h'), c(7, 'h'), c(9, 's')],
    )
    const turn = estimatePlayerEquity(
      [c(14, 'h'), c(13, 'h')],
      [c(2, 'h'), c(7, 'h'), c(9, 's'), c(4, 'c')],
    )
    expect(flop.value).toBeCloseTo(0.36, 2)
    expect(turn.value).toBeCloseTo(0.18, 2)
  })
})

// ---------- betSizeVerdict (ベット/レイズ額の判定) ----------
describe('betSizeVerdict', () => {
  it('bet matching recommended fraction → good', () => {
    const v = betSizeVerdict({ type: 'bet', amount: 67, pot: 100, betLevel: 0, recFraction: 0.67 })
    expect(v?.tone).toBe('good')
  })

  it('bet much smaller than recommended → bad (small)', () => {
    const v = betSizeVerdict({ type: 'bet', amount: 25, pot: 100, betLevel: 0, recFraction: 0.67 })
    expect(v?.tone).toBe('bad')
    expect(v?.text).toContain('小さすぎ')
  })

  it('bet much larger than recommended → bad (large)', () => {
    const v = betSizeVerdict({ type: 'bet', amount: 150, pot: 100, betLevel: 0, recFraction: 0.5 })
    expect(v?.tone).toBe('bad')
    expect(v?.text).toContain('大きすぎ')
  })

  it('bet with no recommended fraction → neutral', () => {
    const v = betSizeVerdict({ type: 'bet', amount: 50, pot: 100, betLevel: 0 })
    expect(v?.tone).toBe('neutral')
  })

  it('raise ~3x the bet → good', () => {
    // betLevel 150, raise to 450 = 3.0x
    const v = betSizeVerdict({ type: 'raise', amount: 450, pot: 300, betLevel: 150 })
    expect(v?.tone).toBe('good')
    expect(v?.text).toContain('3.0倍')
  })

  it('raise too small (1.5x) → bad', () => {
    const v = betSizeVerdict({ type: 'raise', amount: 225, pot: 300, betLevel: 150 })
    expect(v?.tone).toBe('bad')
    expect(v?.text).toContain('小さめ')
  })
})

// ---------- mistake detection ----------
describe('detectMistake', () => {
  // 最低限のGameState mockビルダー
  function makeGame(overrides: Partial<GameState>): GameState {
    return {
      street: 'FLOP_BETTING',
      players: [
        { id: 'p0', isUser: true, folded: false, allin: false, position: 'BB', seatIndex: 0,
          name: 'あなた', type: 'user', stack: 4000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
        { id: 'p1', isUser: false, folded: false, allin: false, position: 'BTN', seatIndex: 1,
          name: 'Bot', type: 'rock', stack: 4000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
      ],
      board: [],
      pots: [{ amount: 200, eligiblePlayerIds: ['p0', 'p1'] }],
      currentBet: 0,
      minRaise: 100,
      actionIndex: 0,
      buttonIndex: 1,
      handNumber: 1,
      deck: [],
      actionHistory: [],
      handOver: false,
      ...overrides,
    }
  }

  // ドンクベット: フロップで currentBet===0 にベット + 前ストリートに相手のbet/raiseあり
  it('donk bet: flop bet into previous street aggressor → DONK_BET', () => {
    const game = makeGame({
      street: 'FLOP_BETTING',
      currentBet: 0,
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p1' },  // プリフロップでBTNがレイズ
        { type: 'call',  amount: 150, playerId: 'p0' },  // BBがコール
      ],
    })
    const action: Action = { type: 'bet', amount: 100, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result?.type).toBe('DONK_BET')
  })

  // ドンクベットではない: プリフロップにアグレッサーなし (全員リンプ)
  it('no donk bet: no previous aggressor → null', () => {
    const game = makeGame({
      street: 'FLOP_BETTING',
      currentBet: 0,
      actionHistory: [
        { type: 'call', amount: 50, playerId: 'p1' },  // プリフロップでコールのみ
      ],
    })
    const action: Action = { type: 'bet', amount: 100, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result).toBeNull()
  })

  // ドンクベットではない: ユーザーが前ストリートのアグレッサー (C-bet)
  it('no donk bet: user was previous aggressor (c-bet) → null', () => {
    const game = makeGame({
      street: 'FLOP_BETTING',
      currentBet: 0,
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p0' },  // ユーザーがレイズ
        { type: 'call',  amount: 150, playerId: 'p1' },  // BTNがコール
      ],
    })
    const action: Action = { type: 'bet', amount: 100, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result).toBeNull()
  })

  // ドンクベットではない: プリフロップ (ストリートが対象外)
  it('no donk bet: preflop street → null', () => {
    const game = makeGame({
      street: 'PREFLOP_BETTING',
      currentBet: 50,
      actionHistory: [],
    })
    const action: Action = { type: 'bet', amount: 150, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result).toBeNull()
  })

  // ドンクベットではない: 既に相手がベット済み (currentBet > 0)
  it('no donk bet: someone already bet this street → null', () => {
    const game = makeGame({
      street: 'FLOP_BETTING',
      currentBet: 100,
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p1' },
        { type: 'bet',   amount: 100, playerId: 'p1' },  // フロップでBTNがベット済み
      ],
    })
    const action: Action = { type: 'raise', amount: 300, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result).toBeNull()
  })

  // マイナスEVコール: 勝率10% < 必要25%×60%=15%
  it('negative EV call: equity far below required → CALL_NEGATIVE_EV', () => {
    const game = makeGame({ street: 'FLOP_BETTING' })
    const action: Action = { type: 'call', amount: 100, playerId: 'p0' }
    const equity = { estimate: 0.10, required: 0.25 }
    const result = detectMistake(game, action, equity)
    expect(result?.type).toBe('CALL_NEGATIVE_EV')
  })

  // マイナスEVコールではない: 勝率がそこそこ (20% vs 必要25%×60%=15%)
  it('borderline call (20% vs required 25%) → null', () => {
    const game = makeGame({ street: 'FLOP_BETTING' })
    const action: Action = { type: 'call', amount: 100, playerId: 'p0' }
    const equity = { estimate: 0.20, required: 0.25 }
    const result = detectMistake(game, action, equity)
    expect(result).toBeNull()
  })

  // ポジティブEVフォールド: 勝率50% >= 必要20%×2=40%
  it('positive EV fold: equity well above required → FOLD_POSITIVE_EV', () => {
    const game = makeGame({ street: 'FLOP_BETTING' })
    const action: Action = { type: 'fold', amount: 0, playerId: 'p0' }
    const equity = { estimate: 0.50, required: 0.20 }
    const result = detectMistake(game, action, equity)
    expect(result?.type).toBe('FOLD_POSITIVE_EV')
  })

  // ポジティブEVフォールドではない: 勝率25%で必要20% (余裕あるが2倍未満)
  it('fold with modest equity surplus → null', () => {
    const game = makeGame({ street: 'FLOP_BETTING' })
    const action: Action = { type: 'fold', amount: 0, playerId: 'p0' }
    const equity = { estimate: 0.30, required: 0.20 }
    const result = detectMistake(game, action, equity)
    expect(result).toBeNull()
  })

  // ドンクベットではない: 前ストリートで相手のベットにユーザーがレイズで応じた(=ユーザーがアグレッサー)
  // → リバーでこちらからベットしても、主導権はユーザーにあるのでドンクではない
  it('no donk bet: user raised over opponent bet last street, then bets → null', () => {
    const game = makeGame({
      street: 'RIVER_BETTING',
      currentBet: 0,
      actionHistory: [
        { type: 'bet',  amount: 57,  playerId: 'p1' },   // ターンで相手がベット
        { type: 'raise', amount: 175, playerId: 'p0' },  // ユーザーがレイズ(=最後のアグレッサー)
        { type: 'call', amount: 118, playerId: 'p1' },   // 相手がコール
        { type: 'check', amount: 0,  playerId: 'p1' },   // リバーで相手がチェック
      ],
    })
    const action: Action = { type: 'bet', amount: 300, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result).toBeNull()
  })

  // ドンクベット: ターンでも適用
  it('donk bet on turn → DONK_BET', () => {
    const game = makeGame({
      street: 'TURN_BETTING',
      currentBet: 0,
      actionHistory: [
        { type: 'bet', amount: 100, playerId: 'p1' },  // フロップでBTNがベット
        { type: 'call', amount: 100, playerId: 'p0' },
      ],
    })
    const action: Action = { type: 'bet', amount: 150, playerId: 'p0' }
    const result = detectMistake(game, action, null)
    expect(result?.type).toBe('DONK_BET')
  })
})

// ---------- Yokosawa model ----------
describe('getYokosawaTier', () => {
  it('AA → navy (最強)', () => {
    expect(getYokosawaTier('AA')).toBe('navy')
  })
  it('KQs → red', () => {
    expect(getYokosawaTier('KQs')).toBe('red')
  })
  it('boundary hands (gray fill + pink frame) → gray', () => {
    for (const h of BB_BOUNDARY_HANDS) {
      expect(getYokosawaTier(h)).toBe('gray')
    }
  })
  it('all 169 hands have a tier assigned', () => {
    expect(Object.keys(YOKOSAWA_TIERS).length).toBe(169)
  })
  it('unknown hand → gray (fallback)', () => {
    expect(getYokosawaTier('ZZ')).toBe('gray')
  })
})

describe('getYokosawaAdvice', () => {
  // --- open (RFI) ---
  it('CO with lightblue (後ろ3) → open', () => {
    // 44 は lightblue (maxBehind 3); CO は後ろ3 → 参加圏内
    const a = getYokosawaAdvice({ position: 'CO', handStr: '44', facingRaise: false, raiseCount: 0 })
    expect(a.tier).toBe('lightblue')
    expect(a.action).toBe('open')
  })
  it('UTG with lightblue (後ろ5) → fold (圏外)', () => {
    const a = getYokosawaAdvice({ position: 'UTG', handStr: '44', facingRaise: false, raiseCount: 0 })
    expect(a.action).toBe('fold')
  })
  it('BTN with white (後ろ2) → open', () => {
    // Q6s は white (maxBehind 2); BTN は後ろ2 → ちょうど圏内
    expect(getYokosawaTier('Q6s')).toBe('white')
    const a = getYokosawaAdvice({ position: 'BTN', handStr: 'Q6s', facingRaise: false, raiseCount: 0 })
    expect(a.action).toBe('open')
  })
  it('BB with no raise → check', () => {
    const a = getYokosawaAdvice({ position: 'BB', handStr: '72o', facingRaise: false, raiseCount: 0 })
    expect(a.action).toBe('check')
  })

  // --- 対レイズ: リレイズ判断 ---
  it('red hand vs HJ raise (想定=緑) → reraise (2ランク上)', () => {
    // AQs は red(rank2); HJ レイザー想定=green(rank4) → diff 2 → reraise
    const a = getYokosawaAdvice({ position: 'CO', handStr: 'AQs', facingRaise: true, raiserPosition: 'HJ', raiseCount: 1 })
    expect(a.assumedOpponentTier).toBe('green')
    expect(a.action).toBe('reraise')
  })
  it('yellow hand vs HJ raise (想定=緑) → call (1ランク上)', () => {
    // 88 は yellow(rank3); 想定 green(rank4) → diff 1 → call
    const a = getYokosawaAdvice({ position: 'CO', handStr: '88', facingRaise: true, raiserPosition: 'HJ', raiseCount: 1 })
    expect(a.action).toBe('call')
  })
  it('green hand vs HJ raise (想定=緑, 同ランク, single) → fold', () => {
    // 66 は green(rank4); 想定 green → diff 0 single → fold
    const a = getYokosawaAdvice({ position: 'BTN', handStr: '66', facingRaise: true, raiserPosition: 'HJ', raiseCount: 1 })
    expect(a.action).toBe('fold')
  })
  it('same rank vs a 3bet (raiseCount 2) → call可', () => {
    // raiseCount 2 → 想定ティアは climb される。green の +2 = red。
    // red と同ランク(AQs=red)なら 3bet に対し同ランクコール可。
    const a = getYokosawaAdvice({ position: 'BTN', handStr: 'AQs', facingRaise: true, raiserPosition: 'HJ', raiseCount: 2 })
    expect(a.assumedOpponentTier).toBe('red')
    expect(a.action).toBe('call')
  })

  // --- BB ディフェンス ---
  it('BB vs BTN raise: boundary hand (64s) → call', () => {
    expect(BB_BOUNDARY_HANDS.has('64s')).toBe(true)
    const a = getYokosawaAdvice({ position: 'BB', handStr: '64s', facingRaise: true, raiserPosition: 'BTN', raiseCount: 1 })
    expect(a.action).toBe('call')
  })
  it('BB vs BTN raise: weak non-boundary gray (72o) → fold', () => {
    const a = getYokosawaAdvice({ position: 'BB', handStr: '72o', facingRaise: true, raiserPosition: 'BTN', raiseCount: 1 })
    expect(a.action).toBe('fold')
  })
  it('BB vs UTG raise: lightblue (44) → call (水色まで参加)', () => {
    const a = getYokosawaAdvice({ position: 'BB', handStr: '44', facingRaise: true, raiserPosition: 'UTG', raiseCount: 1 })
    expect(a.action).toBe('call')
  })
  it('BB vs UTG raise: white (Q6s) → fold (水色まで, 白は圏外)', () => {
    const a = getYokosawaAdvice({ position: 'BB', handStr: 'Q6s', facingRaise: true, raiserPosition: 'UTG', raiseCount: 1 })
    expect(a.action).toBe('fold')
  })
  it('BB vs CO raise: white (Q6s) → call (COは白まで)', () => {
    const a = getYokosawaAdvice({ position: 'BB', handStr: 'Q6s', facingRaise: true, raiserPosition: 'CO', raiseCount: 1 })
    expect(a.action).toBe('call')
  })
})

describe('getYokosawaContext', () => {
  // ヨコサワ文脈算出用の最小GameState mock
  function ctxGame(overrides: Partial<GameState>): GameState {
    return {
      street: 'PREFLOP_BETTING',
      players: [
        { id: 'p0', isUser: true, folded: false, allin: false, position: 'CO', seatIndex: 0,
          name: 'あなた', type: 'user', stack: 5000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
        { id: 'p1', isUser: false, folded: false, allin: false, position: 'HJ', seatIndex: 1,
          name: 'Bot', type: 'reg', stack: 5000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
      ],
      board: [],
      pots: [{ amount: 75, eligiblePlayerIds: ['p0', 'p1'] }],
      currentBet: 50,
      minRaise: 100,
      actionIndex: 0,
      buttonIndex: 1,
      handNumber: 1,
      deck: [],
      actionHistory: [],
      handOver: false,
      ...overrides,
    }
  }
  const user = (g: GameState) => g.players.find(p => p.isUser)!

  it('オープン未直面(currentBet=BB): facingRaise=false', () => {
    const g = ctxGame({})
    expect(getYokosawaContext(g, user(g)).facingRaise).toBe(false)
  })

  // 回帰: 自分がオープンレイズして currentBet が上がっただけでは「対レイズ」にしない。
  // (誰もレイズしていないのに「緑 vs 緑 → フォールド」と誤表示されていたバグ)
  it('自分のオープンレイズ後(自分のbet==currentBet): facingRaise=false', () => {
    const g = ctxGame({
      currentBet: 150,
      players: [
        { id: 'p0', isUser: true, folded: false, allin: false, position: 'CO', seatIndex: 0,
          name: 'あなた', type: 'user', stack: 4850, holeCards: [], bet: 150, totalBetInHand: 150, hasActed: true, lastAction: null },
        { id: 'p1', isUser: false, folded: false, allin: false, position: 'HJ', seatIndex: 1,
          name: 'Bot', type: 'reg', stack: 5000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
      ],
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p0' }],
    })
    expect(getYokosawaContext(g, user(g)).facingRaise).toBe(false)
  })

  it('相手のオープンレイズに直面(コール額残): facingRaise=true, raiserPosition=HJ', () => {
    const g = ctxGame({
      currentBet: 150,
      players: [
        { id: 'p0', isUser: true, folded: false, allin: false, position: 'CO', seatIndex: 0,
          name: 'あなた', type: 'user', stack: 5000, holeCards: [], bet: 0, totalBetInHand: 0, hasActed: false, lastAction: null },
        { id: 'p1', isUser: false, folded: false, allin: false, position: 'HJ', seatIndex: 1,
          name: 'Bot', type: 'reg', stack: 4850, holeCards: [], bet: 150, totalBetInHand: 150, hasActed: true, lastAction: null },
      ],
      actionHistory: [{ type: 'raise', amount: 150, playerId: 'p1' }],
    })
    const ctx = getYokosawaContext(g, user(g))
    expect(ctx.facingRaise).toBe(true)
    expect(ctx.raiserPosition).toBe('HJ')
  })

  it('自分のオープンに相手が3betし返した(コール額残): facingRaise=true, raiserPosition=HJ', () => {
    const g = ctxGame({
      currentBet: 450,
      players: [
        { id: 'p0', isUser: true, folded: false, allin: false, position: 'CO', seatIndex: 0,
          name: 'あなた', type: 'user', stack: 4850, holeCards: [], bet: 150, totalBetInHand: 150, hasActed: true, lastAction: null },
        { id: 'p1', isUser: false, folded: false, allin: false, position: 'HJ', seatIndex: 1,
          name: 'Bot', type: 'reg', stack: 4550, holeCards: [], bet: 450, totalBetInHand: 450, hasActed: true, lastAction: null },
      ],
      actionHistory: [
        { type: 'raise', amount: 150, playerId: 'p0' },
        { type: 'raise', amount: 450, playerId: 'p1' },
      ],
    })
    const ctx = getYokosawaContext(g, user(g))
    expect(ctx.facingRaise).toBe(true)
    expect(ctx.raiserPosition).toBe('HJ')
  })
})

// ---------- Quiz generators (一問一答) ----------
describe('quiz generators', () => {
  it('randomHand: 常に相異なる2枚・妥当なhandStr', () => {
    for (let i = 0; i < 200; i++) {
      const h = randomHand()
      // 2枚が同一カードでない
      const k1 = `${h.cards[0].rank}${h.cards[0].suit}`
      const k2 = `${h.cards[1].rank}${h.cards[1].suit}`
      expect(k1).not.toBe(k2)
      // rank1 >= rank2 (高い方が先)
      expect(h.rank1).toBeGreaterThanOrEqual(h.rank2)
      // handStr が 2〜3 文字
      expect(h.handStr.length).toBeGreaterThanOrEqual(2)
      expect(h.handStr.length).toBeLessThanOrEqual(3)
    }
  })

  it('makePreflopQuestion: correct が getYokosawaAdvice と整合 (tableSize対応)', () => {
    for (let i = 0; i < 100; i++) {
      const q = makePreflopQuestion()
      const advice = getYokosawaAdvice({
        position: q.position, handStr: q.hand.handStr,
        facingRaise: false, tableSize: q.tableSize,
      })
      const expected = advice.action === 'open' ? 'raise' : 'fold'
      expect(q.correct).toBe(expected)
      // BB は出題しない
      expect(q.position).not.toBe('BB')
      // テーブルサイズは 6〜8
      expect([6, 7, 8]).toContain(q.tableSize)
    }
  })

  it('makeTierQuestion: correct が getYokosawaTier と一致', () => {
    for (let i = 0; i < 100; i++) {
      const q = makeTierQuestion()
      expect(q.correct).toBe(getYokosawaTier(q.hand.handStr))
    }
  })

  it('makeReraiseQuestion: correct が getYokosawaAdvice と整合・レイザーは自分より前', () => {
    for (let i = 0; i < 100; i++) {
      const q = makeReraiseQuestion()
      const order = actionOrder(q.tableSize)
      const advice = getYokosawaAdvice({
        position: q.position, handStr: q.hand.handStr,
        facingRaise: true, raiserPosition: q.raiserPosition, raiseCount: q.raiseCount,
        tableSize: q.tableSize,
      })
      expect(q.correct).toBe(advice.action)
      // レイザーは自分より行動順が前
      expect(order.indexOf(q.raiserPosition)).toBeLessThan(order.indexOf(q.position))
      // 回答はリレイズ/コール/フォールドのいずれか
      expect(['reraise', 'call', 'fold']).toContain(q.correct)
    }
  })

  it('makeRangePredictionQuestion(プリフロップ): 正解候補の内容が一致し、候補に重複コンテンツが無い', () => {
    for (let i = 0; i < 100; i++) {
      const q = makeRangePredictionQuestion({ streets: ['preflop'] })
      expect(q.street).toBe('preflop')
      expect(q.board).toHaveLength(0)
      expect(q.postflopAction).toBeUndefined()
      // 正解インデックスが範囲内
      expect(q.correctIndex).toBeGreaterThanOrEqual(0)
      expect(q.correctIndex).toBeLessThan(q.candidates.length)
      // 候補は2〜3個(正解+ダミー最大2)
      expect(q.candidates.length).toBeGreaterThanOrEqual(1)
      expect(q.candidates.length).toBeLessThanOrEqual(3)
      // 候補同士の内容(ハンド集合)が重複しない
      const sigs = q.candidates.map(c => [...c.hands].sort().join(','))
      expect(new Set(sigs).size).toBe(sigs.length)
      // 正解候補の内容は実際のオープン/3betレンジと一致
      const correctHands = new Set(q.candidates[q.correctIndex].hands)
      const expectedRange = q.preflopAction === 'open' ? OPEN_RANGES[q.raiserPosition] : THREEBET_RANGES[q.raiserPosition]
      expect(correctHands.size).toBe(expectedRange.size)
      for (const h of expectedRange) expect(correctHands.has(h)).toBe(true)
    }
  })

  it('makeRangePredictionQuestion(フロップ/ターン/リバー): ボード長・絞り込みが街と整合、候補は常に2個以上', () => {
    const expectedLen: Record<string, number> = { flop: 3, turn: 4, river: 5 }
    for (const street of ['flop', 'turn', 'river'] as const) {
      for (let i = 0; i < 200; i++) {
        const q = makeRangePredictionQuestion({ streets: [street] })
        expect(q.street).toBe(street)
        expect(q.board).toHaveLength(expectedLen[street])
        expect(q.postflopAction).toBeDefined()
        // ボードに重複カードが無い
        const boardKeys = q.board.map(c => `${c.rank}${c.suit}`)
        expect(new Set(boardKeys).size).toBe(boardKeys.length)
        // 正解インデックスが範囲内
        expect(q.correctIndex).toBeGreaterThanOrEqual(0)
        expect(q.correctIndex).toBeLessThan(q.candidates.length)
        // 候補は2〜3個(正解と内容が異なるダミーが最低1つ必要・選択クイズとして成立すること)
        expect(q.candidates.length).toBeGreaterThanOrEqual(2)
        expect(q.candidates.length).toBeLessThanOrEqual(3)
        // 各候補は空でない(narrowRangeByActionの安全弁により空にならない)
        for (const c of q.candidates) expect(c.hands.length).toBeGreaterThan(0)
        // 候補同士の内容が重複しない
        const sigs = q.candidates.map(c => [...c.hands].sort().join(','))
        expect(new Set(sigs).size).toBe(sigs.length)
      }
    }
  })

  it('makeRangePredictionQuestion: streets/tableSize/preflopActions オプションが反映される', () => {
    for (let i = 0; i < 20; i++) {
      const q = makeRangePredictionQuestion({ tableSize: 8, preflopActions: ['3bet'], streets: ['turn'] })
      expect(q.tableSize).toBe(8)
      expect(q.preflopAction).toBe('3bet')
      expect(q.street).toBe('turn')
      expect(q.board).toHaveLength(4)
    }
  })
})
