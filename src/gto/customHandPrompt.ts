// P12 Phase D: 未収録フロップ(同型クラスの読み替え候補も無い)の場合に、入力済みの
// ハンド情報を外部AIチャット(ChatGPT/Claude等)へ相談するための自己完結プロンプトへ
// 整形する純関数。src/gto/explain/exportSpot.ts(既存の「AIに質問用コピー」)と同じ
// 「自己完結マークダウン+末尾に質問文」の方針を踏襲するが、GTO戦略表・features・
// 解説文は載せられない(このアプリの事前計算データに該当フロップが無い=そもそも
// 解析できていないため)。あくまで生の入力(シナリオ・盤面・手札・アクション履歴)のみを
// 提示し、質問文でAIに判断を委ねる。
//
// gto/はui/に依存しない方針のため、ラベルの日本語化はexportSpot.tsと同様に
// このファイル内で完結させる(意図的な重複)。

import type { Card } from '../engine/types'
import { cardLabel } from '../engine/deck'
import type { Scenario } from './types'
import type { Seat } from './trainer/gameFlow'
import type { CustomStreetAction } from './trainer/customHandReview'
import { isOopPosition } from './data/scenarios'

const ACTION_LABEL_JA: Record<string, string> = {
  check: 'チェック',
  fold: 'フォールド',
  call: 'コール',
  bet33: 'ベット33%',
  bet75: 'ベット75%',
  raise55: 'レイズ55%',
  allin: 'オールイン',
}

function actionJa(label: string): string {
  return ACTION_LABEL_JA[label] ?? label
}

const STREET_LABEL_JA = { flop: 'フロップ', turn: 'ターン', river: 'リバー' } as const

export interface CustomHandPromptInput {
  scenario: Scenario
  /** 収録判定前の生のフロップ3枚(必ず埋まっている前提、呼び出し側の責務)。 */
  flopCards: readonly Card[]
  userSeat: Seat
  userCombo: readonly [Card, Card]
  turnCard: Card | null
  riverCard: Card | null
  streetActions: { flop: readonly CustomStreetAction[]; turn: readonly CustomStreetAction[]; river: readonly CustomStreetAction[] }
}

/** 入力済みのカスタムハンドを、外部AIへ相談するための自己完結マークダウンへ整形する。 */
export function buildCustomHandPrompt(input: CustomHandPromptInput): string {
  const { scenario, flopCards, userSeat, userCombo, turnCard, riverCard, streetActions } = input
  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopPosition = oopIsRaiser ? scenario.raiser.position : scenario.defender.position
  const ipPosition = oopIsRaiser ? scenario.defender.position : scenario.raiser.position
  const heroPosition = userSeat === 0 ? oopPosition : ipPosition
  const villainPosition = userSeat === 0 ? ipPosition : oopPosition
  const positionOf = (seat: Seat): string => (seat === 0 ? oopPosition : ipPosition)

  const historyLines: string[] = []
  for (const street of ['flop', 'turn', 'river'] as const) {
    for (const a of streetActions[street]) {
      historyLines.push(`- [${STREET_LABEL_JA[street]}] ${positionOf(a.seat)}${a.seat === userSeat ? '(あなた)' : ''}: ${actionJa(a.label)}`)
    }
  }

  return [
    '# ポーカーGTOハンド相談(未収録フロップ)',
    '',
    'このアプリの事前計算データには該当するフロップ(またはスート違いの近い盤面)が',
    '見つからなかったため、以下の実戦ハンドについてGTO的な観点からのアドバイスを相談したいです。',
    '',
    '## シナリオ',
    scenario.label,
    scenario.descriptionJa,
    `ポット: ${scenario.potBb}bb / 実効スタック: ${scenario.effectiveStackBb}bb`,
    '',
    '## 自分のポジション',
    `${heroPosition}(相手: ${villainPosition})`,
    '',
    '## ボード',
    `フロップ: ${flopCards.map(cardLabel).join(' ')}`,
    `ターン: ${turnCard ? cardLabel(turnCard) : '(未到達)'}`,
    `リバー: ${riverCard ? cardLabel(riverCard) : '(未到達)'}`,
    '',
    '## 自分の手札',
    userCombo.map(cardLabel).join(' '),
    '',
    '## アクション履歴',
    ...(historyLines.length > 0 ? historyLines : ['(まだアクションがありません)']),
    '',
    '---',
    '## 質問',
    '各ストリートでの判断(特にベットサイズ選択や降りるべきかどうか)について、GTOの考え方に基づいてアドバイスをください。',
  ].join('\n')
}
