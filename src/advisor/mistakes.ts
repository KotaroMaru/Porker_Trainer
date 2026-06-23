import type { GameState, Action } from '../engine/types'

export type MistakeType =
  | 'DONK_BET'          // ドンクベット
  | 'CALL_NEGATIVE_EV'  // 必要勝率を大幅に下回るコール
  | 'FOLD_POSITIVE_EV'  // 十分な勝率があるのにフォールド

export interface Mistake {
  type: MistakeType
  label: string
  explanation: string
}

const MISTAKE_INFO: Record<MistakeType, { label: string; explanation: string }> = {
  DONK_BET: {
    label: 'ドンクベット',
    explanation:
      '前のストリートでベット/レイズした相手（アグレッサー）が控えているのに、相手がアクションを取る前にこちらからベットしています。これを「ドンクベット」といい、アウトオブポジション(OOP)からのミスとして知られています。' +
      '相手のレンジはあなたのレンジより強い傾向があり、良い手ならコールやレイズ、弱い手ならフォールドされてしまいます（あなたに不利な両方向のプレッシャー）。' +
      '基本はチェックして相手のアクションを引き出し、それに対応する方が得策です。',
  },
  CALL_NEGATIVE_EV: {
    label: '割に合わないコール',
    explanation:
      'ポットオッズ(必要勝率)に対して、あなたの読みの勝率が大きく足りていません。' +
      'このコールは長期的に損失になります（マイナスEV）。必要勝率を下回っている場合はフォールドが基本です。' +
      'アウツを数え直し、ダーティアウツ(引いても逆に負けるカード)を除外できているか確認しましょう。',
  },
  FOLD_POSITIVE_EV: {
    label: '利益のあるフォールド',
    explanation:
      '十分な勝率(エクイティ)があるにもかかわらずフォールドしています。' +
      'コール額に対してポットが大きく、必要勝率を大きく上回っているのでコールが得な場面です。' +
      'アウツを数え直し、見落としているドローや勝ち筋がないか確認しましょう。',
  },
}

/**
 * ユーザーのアクションがポーカー的なミスかどうかを判定する。
 * equity は { estimate: 推奨の根拠となった勝率, required: 必要勝率 }
 */
export function detectMistake(
  game: GameState,
  userAction: Action,
  equity: { estimate: number | null; required: number } | null,
): Mistake | null {
  if (isDonkBet(game, userAction)) {
    return { type: 'DONK_BET', ...MISTAKE_INFO.DONK_BET }
  }
  if (isNegativeEvCall(userAction, equity)) {
    return { type: 'CALL_NEGATIVE_EV', ...MISTAKE_INFO.CALL_NEGATIVE_EV }
  }
  if (isPositiveEvFold(userAction, equity)) {
    return { type: 'FOLD_POSITIVE_EV', ...MISTAKE_INFO.FOLD_POSITIVE_EV }
  }
  return null
}

/**
 * ドンクベット判定:
 * ポストフロップのベッティングストリートで、まだ誰もベットしていない状態（currentBet===0）に
 * ユーザーがベットし、かつ前のストリートにユーザー以外のアグレッサーが存在する場合。
 */
function isDonkBet(game: GameState, userAction: Action): boolean {
  const postflopStreets: GameState['street'][] = ['FLOP_BETTING', 'TURN_BETTING', 'RIVER_BETTING']
  if (!postflopStreets.includes(game.street)) return false
  if (userAction.type !== 'bet') return false
  if (game.currentBet !== 0) return false  // 既に誰かがベット済み

  const user = game.players.find(p => p.isUser)
  if (!user) return false

  // actionHistoryを逆スキャン: 直近の bet/raise(＝前ストリートの最後のアグレッサー)を探す。
  // currentBet===0 なので今のストリートにはbet/raiseがない → 最初に見つかるbet/raiseが前ストリートのもの。
  // その最後のアグレッサーがユーザー自身なら、こちらが主導権を握っている(C-bet等)のでドンクではない。
  // 相手のベットにユーザーがレイズで応じた場合も「最後のアグレッサー」はユーザーになるため誤検知しない。
  const lastAggressor = [...game.actionHistory]
    .reverse()
    .find(a => a.type === 'bet' || a.type === 'raise')

  return lastAggressor !== undefined && lastAggressor.playerId !== user.id
}

/**
 * マイナスEVコール判定:
 * ユーザーのコール時、推奨勝率が必要勝率の60%以下の場合。
 * 例: 必要25%のところを15%以下で呼ぶ。
 */
function isNegativeEvCall(
  userAction: Action,
  equity: { estimate: number | null; required: number } | null,
): boolean {
  if (userAction.type !== 'call') return false
  if (!equity || equity.estimate == null || equity.required <= 0) return false
  return equity.estimate < equity.required * 0.6
}

/**
 * ポジティブEVフォールド判定:
 * ユーザーのフォールド時、推奨勝率が必要勝率の2倍以上の場合。
 * 例: 必要20%のところを40%以上あるのにフォールド。
 */
function isPositiveEvFold(
  userAction: Action,
  equity: { estimate: number | null; required: number } | null,
): boolean {
  if (userAction.type !== 'fold') return false
  if (!equity || equity.estimate == null || equity.required <= 0) return false
  return equity.estimate >= equity.required * 2
}
