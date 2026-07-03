import type { Position, GameState, Player } from '../engine/types'
import { handString } from './ranges'
import { playersBehind as _playersBehind } from '../engine/positions'

// ============================================================
// 世界のヨコサワ「オリジナルハンドレンジ」モデル
// 役の強さを 7 色のティアで表し、ポジション別の参加可否・
// リレイズ判断・BB ディフェンスを色から導く。
// ============================================================

export type YokosawaTier = 'navy' | 'red' | 'yellow' | 'green' | 'lightblue' | 'white' | 'pink' | 'gray'

export interface TierInfo {
  rank: number        // 1 = 最強
  labelJa: string
  color: string       // セル塗り色(従来テーマ調)
  textColor: string   // セル文字色
  maxBehind: number   // 「後ろの人数がこの数以下なら参加してよい」
}

// 強い順。maxBehind は「後ろの人数 <= maxBehind なら参加圏内」。
// pink は白と灰の境界(BB_BOUNDARY_HANDS)専用の表示ティア。
// rank/maxBehind は gray と同値にし、アドバイス判定ロジック(TIER_ORDER基準)への
// 影響をゼロに保つ(判定は TIER_ORDER の 7 色のみで行う)。
export const TIER_INFO: Record<YokosawaTier, TierInfo> = {
  navy:      { rank: 1, labelJa: '紺',     color: '#2e4cae', textColor: '#ffffff', maxBehind: 8 },
  red:       { rank: 2, labelJa: '赤',     color: '#c0392b', textColor: '#ffffff', maxBehind: 8 },
  yellow:    { rank: 3, labelJa: '黄',     color: '#d4ac0d', textColor: '#1a1a1a', maxBehind: 7 },
  green:     { rank: 4, labelJa: '緑',     color: '#3a9960', textColor: '#ffffff', maxBehind: 5 },
  lightblue: { rank: 5, labelJa: '水色',   color: '#5dade2', textColor: '#10202a', maxBehind: 3 },
  white:     { rank: 6, labelJa: '白',     color: '#e8e8e0', textColor: '#1a1a1a', maxBehind: 2 },
  pink:      { rank: 7, labelJa: 'ピンク', color: '#e84393', textColor: '#ffffff', maxBehind: -1 },
  gray:      { rank: 7, labelJa: '灰',     color: '#5d6b62', textColor: '#cdd6cf', maxBehind: -1 },
}

// 強→弱の並び(アドバイス判定ロジック専用。pink は含めない — climb/weakestOpenTier の
// インデックス計算に影響させないため)。
export const TIER_ORDER: YokosawaTier[] = ['navy', 'red', 'yellow', 'green', 'lightblue', 'white', 'gray']

// 表示専用の並び(レンジ表凡例・色当てクイズの選択肢用)。pink を白と灰の間に挿入。
export const TIER_DISPLAY_ORDER: YokosawaTier[] = ['navy', 'red', 'yellow', 'green', 'lightblue', 'white', 'pink', 'gray']

// 灰と白の境目(ピンク)の 13 ハンド。BTN レイズに対し BB がコール可能になる特別枠。
export const BB_BOUNDARY_HANDS = new Set<string>([
  'A6o', '98o', '54s', '64s', '75s', '86s', '96s', 'T7s', 'J6s', 'Q5s', 'Q4s', 'Q3s', 'Q2s',
])

// 画像を 1 セルずつ照合した非灰ティアの割り当て。
// ここに無い手はすべて灰(gray)。境界 13 ハンドは後段で pink に上書き。
const NONGRAY_TIERS: Partial<Record<YokosawaTier, string[]>> = {
  navy: ['AA', 'AKs', 'AKo', 'KK', 'QQ'],
  red: ['AQs', 'AJs', 'ATs', 'KQs', 'AQo', 'JJ', 'TT', '99'],
  yellow: ['KJs', 'KQo', 'QJs', 'AJo', 'JTs', '88', '77'],
  green: [
    'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
    'KTs', 'K9s', 'QTs', 'KJo', 'ATo', 'T9s', '66', '55',
  ],
  lightblue: ['Q9s', 'QJo', 'J9s', 'KTo', 'JTo', 'T8s', 'A9o', '98s', '44', '33', '22'],
  white: [
    'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
    'Q8s', 'Q7s', 'Q6s', 'J8s', 'J7s', 'QTo', 'K9o', 'Q9o', 'J9o', 'T9o',
    '97s', 'A8o', '87s', 'A7o', '76s', '65s',
  ],
}

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

// 全 169 ハンドを灰で初期化し、非灰ティアを上書きして完成させる。
function buildTierMap(): Record<string, YokosawaTier> {
  const map: Record<string, YokosawaTier> = {}
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      let h: string
      if (i === j) h = `${RANKS[i]}${RANKS[j]}`
      else if (i < j) h = `${RANKS[i]}${RANKS[j]}s`
      else h = `${RANKS[j]}${RANKS[i]}o`
      map[h] = 'gray'
    }
  }
  for (const tier of TIER_ORDER) {
    const hands = NONGRAY_TIERS[tier]
    if (!hands) continue
    for (const h of hands) map[h] = tier
  }
  // 境界13ハンドは表示専用ティア pink に上書き(判定ロジックは BB_BOUNDARY_HANDS.has() を
  // 直接参照するため、ここでの上書きは判定結果に影響しない)。
  for (const h of BB_BOUNDARY_HANDS) map[h] = 'pink'
  return map
}

export const YOKOSAWA_TIERS: Record<string, YokosawaTier> = buildTierMap()

export function getYokosawaTier(handStr: string): YokosawaTier {
  return YOKOSAWA_TIERS[handStr] ?? 'gray'
}

// ポジション別「後ろの人数」(後方互換用、デフォルト6-max)
export const PLAYERS_BEHIND: Record<Position, number> = {
  UTG: 5, 'UTG+1': 4, MP: 3, HJ: 4, CO: 3, BTN: 2, SB: 1, BB: 0,
}

// テーブルサイズを考慮した後ろの人数
function getBehind(pos: Position, tableSize: number): number {
  return _playersBehind(pos, tableSize)
}

// あるポジションが開くであろう「最も弱いティア」(= レイザーの想定ティア)
function weakestOpenTier(pos: Position, tableSize: number = 6): YokosawaTier {
  const behind = getBehind(pos, tableSize)
  let result: YokosawaTier = 'navy'
  for (const t of TIER_ORDER) {
    if (TIER_INFO[t].maxBehind >= behind) result = t
  }
  return result
}

// ティアを steps ランク強く(紺方向へ)。範囲外はクランプ。
function climb(tier: YokosawaTier, steps: number): YokosawaTier {
  const idx = TIER_ORDER.indexOf(tier)
  const ni = Math.max(0, idx - steps)
  return TIER_ORDER[ni]
}

export type YokosawaAction = 'open' | 'reraise' | 'call' | 'check' | 'fold'

export interface YokosawaAdviceParams {
  position: Position
  handStr: string
  facingRaise: boolean
  raiserPosition?: Position
  raiseCount?: number   // この街の bet/raise 回数。1=シングルレイズ、2=3bet…
  tableSize?: number    // テーブル人数 (既定6)
}

export interface YokosawaAdvice {
  action: YokosawaAction
  tier: YokosawaTier
  assumedOpponentTier?: YokosawaTier
  reasoning: string
}

export const YOKOSAWA_ACTION_JA: Record<YokosawaAction, string> = {
  open: 'レイズ (オープン)',
  reraise: 'リレイズ (3ベット)',
  call: 'コール',
  check: 'チェック',
  fold: 'フォールド',
}

function tierJa(t: YokosawaTier): string {
  return TIER_INFO[t].labelJa
}

// BB ディフェンス(BB がレイズに直面)
function bbDefenseAdvice(p: YokosawaAdviceParams, tier: YokosawaTier): YokosawaAdvice {
  const rp = p.raiserPosition
  const rank = TIER_INFO[tier].rank
  // 既定: 水色までコール
  let threshold = TIER_INFO.lightblue.rank
  let thresholdLabel = '水色'
  if (rp === 'CO') {
    threshold = TIER_INFO.white.rank
    thresholdLabel = '白'
  }
  const isBoundary = rp === 'BTN' && BB_BOUNDARY_HANDS.has(p.handStr)
  if (rp === 'BTN') {
    threshold = TIER_INFO.white.rank
    thresholdLabel = '白＋ピンク'
  }
  const callable = rank <= threshold || isBoundary
  // 紺・赤はいかなる状況でもフォールドしない
  const isPremium = tier === 'navy' || tier === 'red'

  if (callable || isPremium) {
    const premiumNote = isPremium ? '(紺/赤はフォールドしない → コール、または 3bet も有力)' : ''
    const boundaryNote = isBoundary ? 'ピンクハンドはBTNレイズ限定でコール可。' : ''
    return {
      action: 'call',
      tier,
      reasoning: `BBディフェンス: ${rp ?? '相手'}のレイズには${thresholdLabel}までコールで参加。${boundaryNote}あなたの手は${tierJa(tier)}で参加圏内なのでコール。${premiumNote}`,
    }
  }
  return {
    action: 'fold',
    tier,
    reasoning: `BBディフェンス: ${rp ?? '相手'}のレイズに対し、${thresholdLabel}より弱い${tierJa(tier)}は参加圏外。フォールド。`,
  }
}

export function getYokosawaAdvice(p: YokosawaAdviceParams): YokosawaAdvice {
  const tier = getYokosawaTier(p.handStr)
  const tierRank = TIER_INFO[tier].rank
  const tblSize = p.tableSize ?? 6
  const behind = getBehind(p.position, tblSize)
  const raiseCount = p.raiseCount ?? (p.facingRaise ? 1 : 0)

  // BB がレイズに直面 → ディフェンス専用ロジック
  if (p.position === 'BB' && p.facingRaise) {
    return bbDefenseAdvice(p, tier)
  }

  // レイズに未直面
  if (!p.facingRaise) {
    // BB はコール額0でチェック(無料でフロップ)
    if (p.position === 'BB') {
      return { action: 'check', tier, reasoning: `BBは誰もレイズしていなければ無料でフロップが見られる。チェック。` }
    }
    const maxBehind = TIER_INFO[tier].maxBehind
    if (maxBehind >= behind) {
      return {
        action: 'open',
        tier,
        reasoning: `${tierJa(tier)}は「後ろ${maxBehind}人以下で参加」のティア。${p.position}は後ろ${behind}人なので参加圏内 → レイズでオープン。`,
      }
    }
    return {
      action: 'fold',
      tier,
      reasoning: tier === 'gray' || tier === 'pink'
        ? `${tierJa(tier)}はフォールド（参加不可）。`
        : `${tierJa(tier)}（後ろ${maxBehind}人以下で参加）は${p.position}（後ろ${behind}人）では参加圏外 → フォールド。`,
    }
  }

  // シングル/マルチレイズに直面(BB以外) → リレイズ判断
  const basePos = p.raiserPosition ?? p.position
  let assumed = weakestOpenTier(basePos, tblSize)
  // 再レイズが重なるほど想定ティアを +2 ランクずつ強く
  if (raiseCount >= 2) assumed = climb(assumed, 2 * (raiseCount - 1))
  const assumedRank = TIER_INFO[assumed].rank
  const diff = assumedRank - tierRank   // 正 = 自分の方が強い

  const raiserDesc = p.raiserPosition
    ? `${p.raiserPosition}のレイズ${raiseCount >= 2 ? `(${raiseCount}回目の再レイズ)` : ''}`
    : 'レイズ'
  const cmp = `相手の手を${tierJa(assumed)}と仮定。あなたは${tierJa(tier)}。`

  let action: YokosawaAction
  let verdict: string
  if (diff >= 2) {
    action = 'reraise'
    verdict = `2ランク以上上なのでリレイズ(3bet)。`
  } else if (diff === 1) {
    action = 'call'
    verdict = `1ランク上なのでコール。`
  } else if (diff === 0) {
    if (raiseCount >= 2) {
      action = 'call'
      verdict = `同ランクだが再レイズ(3bet以降)に対しては同ランクもコール可。`
    } else {
      action = 'fold'
      verdict = `同ランクは基本フォールド(コール/フォールドの境界)。`
    }
  } else {
    action = 'fold'
    verdict = `相手の想定より弱いのでフォールド。`
  }

  // 紺・赤はフォールドしない
  if (action === 'fold' && (tier === 'navy' || tier === 'red')) {
    action = 'call'
    verdict += ` ただし紺/赤はフォールドしない → コール。`
  }

  return {
    action,
    tier,
    assumedOpponentTier: assumed,
    reasoning: `${raiserDesc}に直面。${cmp}${verdict}`,
  }
}

// ============================================================
// ゲーム状態からヨコサワ判断の文脈を取り出す(判定パネル用)
// ============================================================
export interface YokosawaContext {
  facingRaise: boolean
  raiserPosition?: Position
  raiseCount: number
  tableSize: number
}

export function getYokosawaContext(game: GameState, user: Player): YokosawaContext {
  const BIG_BLIND = 50
  const isPreflop = game.street === 'PREFLOP_BETTING'
  // 「対レイズ」は、相手のレイズに直面しコール額が残っている時のみ。
  // 自分のオープンレイズで currentBet が上がっただけ(コール額0)の場合は対象外。
  // これを見落とすと、自分のオープン後に相手がいないのに「相手の想定ティア」を
  // 自分のポジションから捏造し「緑 vs 緑 → フォールド」等の誤表示が出る。
  const callAmount = Math.max(0, game.currentBet - user.bet)
  const outstanding = isPreflop ? game.currentBet > BIG_BLIND : game.currentBet > 0
  const facingRaise = outstanding && callAmount > 0
  // プリフロップなら actionHistory はこの街の行動のみ。bet/raise を数える。
  const raises = game.actionHistory.filter(a => a.type === 'raise' || a.type === 'bet')
  const raiseCount = raises.length
  const lastRaise = [...raises].reverse().find(a => a.playerId !== user.id)
  const raiserPlayer = lastRaise ? game.players.find(p => p.id === lastRaise.playerId) : undefined
  return { facingRaise, raiserPosition: raiserPlayer?.position, raiseCount, tableSize: game.players.length }
}

// ユーザーの手をヨコサワ表記(例 'AKs')に変換するヘルパー
export function userHandStr(user: Player): string | null {
  if (user.holeCards.length !== 2) return null
  const [c1, c2] = user.holeCards
  return handString(c1.rank, c2.rank, c1.suit === c2.suit)
}
