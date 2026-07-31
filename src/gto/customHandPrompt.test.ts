import { describe, expect, it } from 'vitest'
import { buildCustomHandPrompt } from './customHandPrompt'
import { getScenario } from './data/scenarios'
import type { Card } from '../engine/types'

describe('buildCustomHandPrompt', () => {
  const scenario = getScenario('srp_utg_vs_bb') // raiser=UTG, defender(caller)=BB
  const flopCards: Card[] = [
    { rank: 14, suit: 'c' },
    { rank: 11, suit: 'c' },
    { rank: 13, suit: 's' },
  ]
  const userCombo: [Card, Card] = [
    { rank: 4, suit: 'c' },
    { rank: 9, suit: 'd' },
  ]

  it('シナリオ・ポジション・ボード・手札・質問文を含む自己完結プロンプトを生成する', () => {
    const md = buildCustomHandPrompt({
      scenario,
      flopCards,
      userSeat: 0, // srp_utg_vs_bb: BBがOOP(seat0)
      userCombo,
      turnCard: null,
      riverCard: null,
      streetActions: { flop: [], turn: [], river: [] },
    })

    expect(md).toContain('未収録フロップ')
    expect(md).toContain(scenario.label)
    expect(md).toContain('BB')
    expect(md).toContain('UTG')
    expect(md).toContain('A♣ J♣ K♠')
    expect(md).toContain('4♣ 9♦')
    expect(md).toContain('(未到達)')
    expect(md).toContain('質問')
    expect(md).toContain('(まだアクションがありません)')
  })

  it('ターン・リバーが確定していれば「未到達」ではなく実際のカードを表示する', () => {
    const md = buildCustomHandPrompt({
      scenario,
      flopCards,
      userSeat: 0,
      userCombo,
      turnCard: { rank: 2, suit: 'h' },
      riverCard: { rank: 3, suit: 'h' },
      streetActions: { flop: [], turn: [], river: [] },
    })
    expect(md).toContain('ターン: 2♥')
    expect(md).toContain('リバー: 3♥')
    expect(md).not.toContain('未到達')
  })

  it('アクション履歴をストリート・手番・自分/相手の別つきで列挙する', () => {
    const md = buildCustomHandPrompt({
      scenario,
      flopCards,
      userSeat: 0,
      userCombo,
      turnCard: null,
      riverCard: null,
      streetActions: {
        flop: [
          { seat: 0, label: 'check' },
          { seat: 1, label: 'bet33' },
        ],
        turn: [],
        river: [],
      },
    })
    expect(md).toContain('[フロップ] BB(あなた): チェック')
    expect(md).toContain('[フロップ] UTG: ベット33%')
  })
})
