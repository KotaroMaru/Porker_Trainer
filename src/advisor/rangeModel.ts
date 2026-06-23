import type { Card, GameState, Player, Position, Street } from '../engine/types'
import type { Combo, HandRange } from '../analysis/range'
import { expandRange } from '../analysis/range'
import { OPEN_RANGES, THREEBET_RANGES, BB_CALL_RANGE, handString } from './ranges'
import { classifyHandStrength } from './postflop'
import type { HandStrength } from './postflop'

export type PreflopRangeAction = 'open' | '3bet' | 'call' | 'limp'

/** ポジションとプリフロップアクションから、そのアクションを取りうるハンドレンジを返す。 */
export function getPreflopRange(pos: Position, action: PreflopRangeAction): HandRange {
  switch (action) {
    case 'open':
      return OPEN_RANGES[pos]
    case '3bet':
      return THREEBET_RANGES[pos]
    case 'call':
      if (pos === 'BB') return BB_CALL_RANGE
      // 非BBのフラットコール = オープンレンジから3betレンジ(レイズする部分)を除いた残り
      return new Set([...OPEN_RANGES[pos]].filter(h => !THREEBET_RANGES[pos].has(h)))
    case 'limp':
      // リンプは厳密な専用レンジが無いため、BBコールレンジ相当の広さで近似
      return BB_CALL_RANGE
  }
}

const STREET_BOARD_LEN: Partial<Record<Street, number>> = {
  FLOP_BETTING: 3,
  TURN_BETTING: 4,
  RIVER_BETTING: 5,
}

const POSTFLOP_STREETS: Street[] = ['FLOP_BETTING', 'TURN_BETTING', 'RIVER_BETTING']

const FULL_RANK_LETTERS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

/** プリフロップで未だ行動していないプレイヤー用のフォールバック: 169ハンド全体。 */
function buildFullRange(): HandRange {
  const set = new Set<string>()
  for (let i = 0; i < FULL_RANK_LETTERS.length; i++) {
    for (let j = 0; j < FULL_RANK_LETTERS.length; j++) {
      const a = FULL_RANK_LETTERS[i]
      const b = FULL_RANK_LETTERS[j]
      if (i === j) set.add(`${a}${b}`)
      else if (i < j) set.add(`${a}${b}s`)
      else set.add(`${b}${a}o`)
    }
  }
  return set
}

export const FULL_RANGE: HandRange = buildFullRange()

const AGGRESSIVE_STRENGTHS: HandStrength[] = ['MONSTER', 'STRONG_MADE', 'MIDDLE', 'STRONG_DRAW']
const CALL_STRENGTHS: HandStrength[] = ['MIDDLE', 'WEAK_PAIR', 'STRONG_DRAW', 'WEAK_DRAW']
// 「一部だけ残す」帯のサンプリング間隔(1/N を残す)。5 = 20%。
const BONUS_SAMPLE_STEP = 5

function filterByStrength(combos: Combo[], board: Card[], allowed: HandStrength[], bonus: HandStrength[]): Combo[] {
  const kept: Combo[] = []
  let bonusSeen = 0
  for (const combo of combos) {
    const strength = classifyHandStrength(combo, board)
    if (allowed.includes(strength)) {
      kept.push(combo)
    } else if (bonus.includes(strength)) {
      bonusSeen++
      if (bonusSeen % BONUS_SAMPLE_STEP === 0) kept.push(combo)
    }
  }
  return kept
}

export type PostflopRangeAction = 'bet' | 'raise' | 'call' | 'allin' | 'check'

/**
 * あるストリートでの1アクションに基づき、レンジ(コンボ配列)を絞り込む。
 * bet/raise/allin = 強い手・ドロー中心(+エアの一部をブラフとして残す)。
 * call = 中間の強さ中心(+強い完成手の一部をスローブレイとして残す)。
 * check = パッシブなので絞り込まない。
 * 絞り込んだ結果が空になる場合は元のコンボを返す(呼び出し側で安全弁として利用可能)。
 */
export function narrowRangeByAction(combos: Combo[], board: Card[], action: PostflopRangeAction): Combo[] {
  let next: Combo[]
  if (action === 'bet' || action === 'raise' || action === 'allin') {
    next = filterByStrength(combos, board, AGGRESSIVE_STRENGTHS, ['AIR'])
  } else if (action === 'call') {
    next = filterByStrength(combos, board, CALL_STRENGTHS, ['STRONG_MADE'])
  } else {
    next = combos
  }
  return next.length > 0 ? next : combos
}

/** コンボ配列を、含まれるハンド表記(例 'AKs')の集合に変換する(表示・候補生成用)。 */
export function combosToHandSet(combos: Combo[]): HandRange {
  const set = new Set<string>()
  for (const [a, b] of combos) {
    set.add(handString(a.rank, b.rank, a.suit === b.suit))
  }
  return set
}

/**
 * ゲーム状態とこのプレイヤーのアクション履歴から、現時点のレンジ(コンボ配列)を推定する。
 * プリフロップの最終アクションで開始レンジを決め、完了したストリート毎に
 * classifyHandStrength ベースのヒューリスティックで動的に絞り込む。
 * GTOソルバーではなく簡易近似であり、ボットの個性(VPIP等)による補正は行わない。
 *
 * @param dead 確実に除外すべきカード(ボード、必要なら他プレイヤーの既知ホールカード)。
 *             ヒーロー自身のレンジを推定する場合は自分の実カードを dead に含めない
 *             (実カードもレンジ内の1コンボとして残すため)。
 */
export function inferPlayerRange(game: GameState, player: Player, dead: Card[]): Combo[] {
  const myActions = game.actionHistory.filter(a => a.playerId === player.id)
  const allPreflopActions = game.actionHistory.filter(a => (a.street ?? 'PREFLOP_BETTING') === 'PREFLOP_BETTING')
  const preflopActions = myActions.filter(a => (a.street ?? 'PREFLOP_BETTING') === 'PREFLOP_BETTING')
  const lastPreflop = preflopActions[preflopActions.length - 1]

  // まだ一度もプリフロップで行動していない(手番が来ていない/ブラインドのみ)プレイヤーは
  // 情報が無いため全レンジ(169ハンド)を初期値とする。
  let baseRange: HandRange
  if (preflopActions.length === 0) {
    baseRange = FULL_RANGE
  } else {
    let preflopAction: PreflopRangeAction
    if (lastPreflop.type === 'raise' || lastPreflop.type === 'bet' || lastPreflop.type === 'allin') {
      // 「3bet」かどうかは自分の行動回数ではなく、自分の最後のレイズまでに
      // 全員でレイズ/ベットが何回起きたかで判定する(2回目以降のレイズ=3bet以降)。
      const idx = allPreflopActions.indexOf(lastPreflop)
      const raisesUpToMine = allPreflopActions
        .slice(0, idx + 1)
        .filter(a => a.type === 'raise' || a.type === 'bet' || a.type === 'allin').length
      preflopAction = raisesUpToMine >= 2 ? '3bet' : 'open'
    } else if (lastPreflop.type === 'call') {
      preflopAction = 'call'
    } else {
      preflopAction = 'limp'
    }
    baseRange = getPreflopRange(player.position, preflopAction)
  }

  let combos = expandRange(baseRange, dead)

  if (combos.length === 0) {
    // 安全弁: 絞りすぎて全滅したらオープンレンジ相当にフォールバック
    combos = expandRange(getPreflopRange(player.position, 'open'), dead)
  }

  for (const street of POSTFLOP_STREETS) {
    const boardLen = STREET_BOARD_LEN[street]!
    if (game.board.length < boardLen) break // このストリートにはまだ到達していない

    const streetActions = myActions.filter(a => a.street === street)
    if (streetActions.length === 0) continue // このストリートで未行動(まだ情報なし)

    const lastAction = streetActions[streetActions.length - 1]
    const board = game.board.slice(0, boardLen)
    const actionForNarrowing: PostflopRangeAction =
      lastAction.type === 'fold' ? 'check' : lastAction.type
    combos = narrowRangeByAction(combos, board, actionForNarrowing)
  }

  return combos
}
