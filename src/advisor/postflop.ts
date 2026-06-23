import type { Card, Player } from '../engine/types'
import type { ActionType } from '../engine/types'
import { evaluate, handDefiningCards } from '../engine/evaluator'
import type { HandCategory } from '../engine/types'
import { classifyDraws } from '../analysis/outs'

const cardKey = (c: Card) => `${c.rank}${c.suit}`

export type HandStrength =
  | 'MONSTER'
  | 'STRONG_MADE'
  | 'MIDDLE'
  | 'WEAK_PAIR'
  | 'STRONG_DRAW'
  | 'WEAK_DRAW'
  | 'AIR'

export function classifyHandStrength(holeCards: Card[], board: Card[]): HandStrength {
  if (board.length === 0 || holeCards.length < 2) return 'AIR'
  const seven = [...holeCards, ...board]
  const result = evaluate(seven)

  // ドロー判定 (ノーハンドやセミブラフのため)
  const draws = classifyDraws(holeCards, board)
  const drawStrength: HandStrength | null =
    draws.hasFlushDraw || draws.hasOESD ? 'STRONG_DRAW'
    : draws.hasGutshot ? 'WEAK_DRAW'
    : null

  // 自分の手札が「役の核」に絡んでいるかを判定する。
  // 例: ボードが KK のペアで自分が 9 3 の場合、KK は全員共有のボード役であり
  //     自分の手ではない (= 場のカードでプレイしている)。完成手扱いしてはいけない。
  const def = handDefiningCards(seven)
  const holeKeys = new Set(holeCards.map(cardKey))
  const usesHole = def.cards.some(c => holeKeys.has(cardKey(c)))

  if (!usesHole) {
    // 役が場のカードだけで成立 (場のカードでプレイ)。自分の本当の強さはドローかノーハンド。
    return drawStrength ?? 'AIR'
  }

  switch (result.category as HandCategory) {
    case 'ROYAL_FLUSH':
    case 'STRAIGHT_FLUSH':
    case 'FOUR_OF_A_KIND':
    case 'FULL_HOUSE':
      return 'MONSTER'
    case 'FLUSH':
    case 'STRAIGHT':
      return 'STRONG_MADE'
    case 'THREE_OF_A_KIND':
    case 'TWO_PAIR':
      return 'STRONG_MADE'
    case 'ONE_PAIR': {
      // 自分の手札が絡むペア。トップペア(以上)=ミドル、それ以下=弱いペア
      const boardRanks = board.map(c => c.rank).sort((a, b) => b - a)
      const topBoardRank = boardRanks[0]
      const pairRank = def.cards[0]?.rank
      if (pairRank !== undefined && pairRank >= topBoardRank) return 'MIDDLE'
      return 'WEAK_PAIR'
    }
    case 'HIGH_CARD':
      return drawStrength ?? 'AIR'
    default:
      return 'AIR'
  }
}

// ===== ショーダウンバリュー(相対的な手の強さ) =====
// 「役のランク」ではなく「チェックで回したとき勝てる見込み」を、ボードのテクスチャを
// 考慮して評価する。例: ペアボード上の小さいポケットペアは"ツーペア"でも実質最弱。
export type ShowdownValue = 'strong' | 'medium' | 'weak' | 'none'

// ボードで一番高いペアのランク (なければ null)
function boardPairRank(board: Card[]): number | null {
  const counts = new Map<number, number>()
  for (const c of board) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
  let best: number | null = null
  for (const [rank, n] of counts) {
    if (n >= 2 && (best === null || rank > best)) best = rank
  }
  return best
}

// ツーペアのSDV。ペアボード上の「ボードペア + 自分の小ペア」は弱い/価値なし。
function twoPairShowdownValue(holeCards: Card[], board: Card[]): ShowdownValue {
  const bpRank = boardPairRank(board)
  if (bpRank === null) return 'strong' // ボード非ペア = 両手札を使った本物のツーペア
  const def = handDefiningCards([...holeCards, ...board])
  const pairRanks = [...new Set(def.cards.map(c => c.rank))]
  const ownPair = pairRanks.find(r => r !== bpRank)
  if (ownPair === undefined) return 'none'
  const topBoard = Math.max(...board.map(c => c.rank))
  if (ownPair >= topBoard) return 'strong'              // トップカードとペア + ボードペア
  const overcards = board.filter(c => c.rank > ownPair).length
  if (overcards >= 3) return 'none'                     // 多くのオーバーカードに埋もれる(44 on T等)
  return 'weak'
}

// 手の強さとボードから「ショーダウンで勝てる見込み」を評価
export function assessShowdownValue(holeCards: Card[], board: Card[], strength: HandStrength): ShowdownValue {
  if (strength === 'MONSTER') return 'strong'
  if (strength === 'STRONG_MADE') {
    const made = evaluate([...holeCards, ...board])
    if (made.category === 'TWO_PAIR') return twoPairShowdownValue(holeCards, board)
    return 'strong' // セット/トリップス/ストレート/フラッシュ
  }
  if (strength === 'MIDDLE') return 'medium' // トップペア/オーバーペア
  if (strength === 'WEAK_PAIR') return 'weak'
  // ドロー(完成前)・エア → 現時点のショーダウンバリューは無い
  return 'none'
}

// 実戦でプレイヤーが見積もれる勝率（厳密MCではなく、テーブルで出せる概算）
// ドロー = 4-2ルール、完成手 = ショーダウンバリューからの読み
export interface PlayerEstimate {
  value: number
  method: 'draw' | 'made' | 'no_sdv' | 'air'
  outs: number
  strength: HandStrength
  sdv: ShowdownValue
}

const SDV_EQUITY: Record<ShowdownValue, number> = {
  strong: 0.72,
  medium: 0.55,
  weak: 0.38,
  none: 0.10,
}

// 完成手とみなす強さ (ペア以上)。ドロー/エアは「完成手」ではない。
const MADE_STRENGTHS = new Set<HandStrength>(['MONSTER', 'STRONG_MADE', 'MIDDLE', 'WEAK_PAIR'])

export function estimatePlayerEquity(holeCards: Card[], board: Card[]): PlayerEstimate {
  const strength = classifyHandStrength(holeCards, board)
  const sdv = assessShowdownValue(holeCards, board, strength)
  // 4-2ルールに使う「きれいなアウツ」(フラッシュドロー/ストレートドロー)。
  const draws = classifyDraws(holeCards, board)
  const drawOuts = draws.flushDrawOuts + draws.straightDrawOuts
  // 4-2ルール: フロップ(残り2枚)=×4 / ターン(残り1枚)=×2 / リバー=ドロー無し
  const mult = board.length === 3 ? 4 : board.length === 4 ? 2 : 0
  const drawEq = mult > 0 ? Math.min((drawOuts * mult) / 100, 0.95) : 0
  // 完成手の読み = SDVベース (MONSTERは別格)
  const madeEq = strength === 'MONSTER' ? 0.92 : SDV_EQUITY[sdv]
  // ドローの伸び と 手の強さ の高い方を「実戦での読み」とする
  if (drawEq > 0 && drawEq >= madeEq) {
    return { value: drawEq, method: 'draw', outs: drawOuts, strength, sdv }
  }
  // ペア以上の完成手か / 完成手だがSDVなし / そもそもノーハンド
  let method: PlayerEstimate['method']
  if (MADE_STRENGTHS.has(strength)) {
    method = sdv === 'none' ? 'no_sdv' : 'made' // ペアはあるが価値なし vs 価値あり完成手
  } else {
    method = 'air'
  }
  return { value: madeEq, method, outs: drawOuts, strength, sdv }
}

export type RecommendedAction = {
  action: ActionType
  betSizeFraction?: number
  reason: string
}

export interface PostflopAdvice {
  recommended: RecommendedAction
  handStrength: HandStrength
  alternativeActions: { action: ActionType; reasoning: string }[]
}

export function getPostflopAdvice(
  holeCards: Card[],
  board: Card[],
  equity: number,
  requiredEquity: number,
  facingBet: boolean,
  canCheck: boolean,
  activeOpponents: Player[],
): PostflopAdvice {
  const strength = classifyHandStrength(holeCards, board)
  const sdv = assessShowdownValue(holeCards, board, strength)
  const isDraw = (strength === 'STRONG_DRAW' || strength === 'WEAK_DRAW') && board.length < 5
  const hasPair = MADE_STRENGTHS.has(strength) // 一応ペア以上の役は作っている
  // 相手がフォールドしやすいか / 降ろせない(コーリングステーション)か
  const foldableOpp = activeOpponents.some(p => p.type === 'rock' || p.type === 'reg')
  const callingStation = activeOpponents.some(p => p.type === 'station' || p.type === 'fishy')

  let recommended: RecommendedAction
  const alternatives: { action: ActionType; reasoning: string }[] = []

  // ===== 1. ドロー(完成前): セミブラフ =====
  if (isDraw) {
    if (facingBet) {
      if (equity >= requiredEquity) {
        if (foldableOpp && equity >= 0.35 && strength === 'STRONG_DRAW') {
          recommended = { action: 'raise', reason: 'SEMI_BLUFF_RAISE' }
          alternatives.push({ action: 'call', reasoning: 'コールも+EV。セミブラフのリスクを避けたい場合' })
        } else {
          recommended = { action: 'call', reason: 'POT_ODDS_CALL' }
          alternatives.push({ action: 'raise', reasoning: 'セミブラフレイズ。降ろせる相手なら有効' })
        }
      } else {
        recommended = { action: 'fold', reason: 'POT_ODDS_FOLD' }
      }
    } else {
      recommended = { action: 'bet', betSizeFraction: 0.5, reason: 'SEMI_BLUFF_RAISE' }
      alternatives.push({ action: 'check', reasoning: 'ドローを隠して無料でカードを見るのも可' })
    }
  }
  // ===== 2. 強いショーダウンバリュー: バリュー =====
  else if (sdv === 'strong') {
    const sizeFrac = strength === 'MONSTER' ? 0.75 : 0.67
    if (facingBet) {
      if (equity >= requiredEquity) {
        recommended = { action: 'call', reason: 'POT_ODDS_CALL' }
        alternatives.push({ action: 'raise', reasoning: 'バリューレイズでポットを大きくするのも有力' })
      } else {
        recommended = { action: 'fold', reason: 'POT_ODDS_FOLD' }
      }
    } else {
      recommended = { action: 'bet', betSizeFraction: sizeFrac, reason: 'VALUE_BET' }
      alternatives.push({ action: 'check', reasoning: 'スロープレイ/ポットコントロールも可' })
    }
  }
  // ===== 3. 中程度のショーダウンバリュー(トップペア等): ポットコントロール =====
  else if (sdv === 'medium') {
    if (facingBet) {
      recommended = equity >= requiredEquity
        ? { action: 'call', reason: 'POT_ODDS_CALL' }
        : { action: 'fold', reason: 'POT_ODDS_FOLD' }
    } else if (canCheck) {
      recommended = { action: 'check', reason: 'CHECK_BEHIND' }
      alternatives.push({ action: 'bet', reasoning: '薄いバリューベットも可。相手のコール範囲に注意' })
    } else {
      recommended = { action: 'bet', betSizeFraction: 0.5, reason: 'VALUE_BET' }
    }
  }
  // ===== 4. 弱いが多少のショーダウンバリュー: チェックで見せ合い =====
  else if (sdv === 'weak') {
    if (facingBet) {
      recommended = equity >= requiredEquity
        ? { action: 'call', reason: 'POT_ODDS_CALL' }
        : { action: 'fold', reason: 'POT_ODDS_FOLD' }
    } else {
      // 多少のSDVがあるので、ベットせずチェックで安くショーダウンを狙う
      recommended = { action: 'check', reason: 'CHECK_BEHIND' }
      alternatives.push({ action: 'bet', reasoning: '薄いバリュー/ブロックベットも状況次第で可' })
    }
  }
  // ===== 5. ショーダウンバリューなし: フォールド or ブラフ転化 or 諦め =====
  else { // sdv === 'none'  (エア、空振りドロー、あるいは価値の無くなったペア)
    if (facingBet) {
      if (equity >= requiredEquity) {
        // フロップ/ターンで多少のエクイティがあるならコール (リバーではほぼ起きない)
        recommended = { action: 'call', reason: 'POT_ODDS_CALL' }
      } else {
        recommended = { action: 'fold', reason: hasPair ? 'NO_SDV_FOLD' : 'BLUFF_FOLD' }
        alternatives.push({ action: 'call', reasoning: `勝率${Math.round(equity*100)}%では長期的に-EV` })
      }
    } else {
      // チェックで回しても勝てない → 降ろせる相手なら「ブラフに転化」してベット、無理なら諦めてチェック
      if (foldableOpp && !callingStation) {
        // 価値のあるペアを作っているのにSDVが無い = ブラフへの転化 (Turning a hand into a bluff)
        const reason = hasPair ? 'TURN_INTO_BLUFF' : 'BLUFF_BET'
        recommended = { action: 'bet', betSizeFraction: 0.6, reason }
        alternatives.push({ action: 'check', reasoning: '降りない相手(コーリングステーション)には諦めてチェック' })
      } else {
        recommended = { action: 'check', reason: 'GIVE_UP_CHECK' }
        alternatives.push({ action: 'bet', reasoning: 'フォールドしやすい相手にはブラフに転化してベットも可' })
      }
    }
  }

  return { recommended, handStrength: strength, alternativeActions: alternatives }
}
