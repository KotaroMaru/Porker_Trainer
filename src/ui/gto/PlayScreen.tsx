import { useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { buildPreflopScript } from '../../gto/trainer/preflopScript'
import { isOopPosition } from '../../gto/data/scenarios'
import { CardView } from '../CardView'
import { ReviewScreen } from './ReviewScreen'
import { actionLabelJa, rankLabel, suitSymbol } from './labels'

// P4 Step D / P5 Step B9: フロップ単発モードのプレイ画面。採点後(status==='graded')は
// フェルトテーブル+履歴ストリップごとReviewScreenにフルテイクオーバーする
// (承認済みUX仕様: ボード+ハンドはReviewScreen側のコンパクト1行表示で代替、
// モバイルで縦長になりすぎるのを防ぐ)。

export function PlayScreen() {
  const { status, spot, sessionTally, errorMessage, startNewSpot, chooseAction } = useGtoStore()

  useEffect(() => {
    if (status === 'idle') void startNewSpot()
  }, [status, startNewSpot])

  if (status === 'error') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: 'var(--red)', marginBottom: 12 }}>解データの読み込みに失敗しました。</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 16 }}>{errorMessage}</p>
        <button onClick={() => void startNewSpot()} style={{ padding: '8px 20px' }}>
          再試行
        </button>
      </div>
    )
  }

  if ((status === 'idle' || status === 'loading') && !spot) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>読み込み中...</div>
  }

  if (!spot) return null

  if (status === 'graded') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ReviewScreen />
        <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
          単発モード ・ {sessionTally.spots}問 ・ 正解{sessionTally.correct} ・ 累計EVロス {sessionTally.totalEvLossBb.toFixed(2)}bb
        </div>
      </div>
    )
  }

  const oopIsRaiser = isOopPosition(spot.scenario.raiser.position, spot.scenario.defender.position)
  const oopPosition = oopIsRaiser ? spot.scenario.raiser.position : spot.scenario.defender.position
  const ipPosition = oopIsRaiser ? spot.scenario.defender.position : spot.scenario.raiser.position
  const userPosition = spot.userSeat === 0 ? oopPosition : ipPosition
  const botPosition = spot.userSeat === 0 ? ipPosition : oopPosition

  const preflopLines = buildPreflopScript(spot.scenario)
  const board = boardFromFlop(spot.flop)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ストリート別履歴ストリップ */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          border: '1px solid var(--panel-border)',
          borderRadius: 8,
          overflow: 'hidden',
          fontSize: 13,
        }}
      >
        <div style={{ flex: 1, padding: 8, borderRight: '1px solid var(--panel-border)' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>プリフロップ</div>
          {preflopLines.map((line, i) => (
            <div key={i} style={{ color: 'var(--text)' }}>
              {line.position}: {line.action} {line.amountBb}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 8, background: 'var(--panel-bg-light)' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
            <span>フロップ</span>
            {board.map((c, i) => (
              <span key={i} style={{ color: c.suit === 'h' || c.suit === 'd' ? 'var(--card-red)' : 'var(--text)' }}>
                {rankLabel(c.rank)}
                {suitSymbol(c.suit)}
              </span>
            ))}
            <span>({spot.scenario.potBb})</span>
          </div>
          {spot.botActionsBefore.map((entry, i) => (
            <div key={i} style={{ color: 'var(--text)' }}>
              {botPosition}: {actionLabelJa(entry.label)}
            </div>
          ))}
          <div style={{ background: 'var(--gold)', color: '#000', display: 'inline-block', padding: '1px 6px', borderRadius: 4 }}>{userPosition}: ?</div>
        </div>
      </div>

      {/* テーブル */}
      <div
        style={{
          background: 'var(--green-felt)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <CardView faceDown size="sm" />
          <CardView faceDown size="sm" />
          <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center', marginLeft: 6 }}>{botPosition}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ color: 'var(--gold-light)', fontSize: 14 }}>ポット {spot.scenario.potBb}bb</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {board.map((c, i) => (
              <div key={i} style={{ border: '2px solid var(--gold)', borderRadius: 6 }}>
                <CardView card={c} size="md" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center', marginRight: 6 }}>{userPosition}(あなた)</span>
          <CardView card={spot.userCombo[0]} size="sm" />
          <CardView card={spot.userCombo[1]} size="sm" />
        </div>
      </div>

      {/* アクションボタン */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {spot.actionsWithAmounts.map((a) => (
          <button
            key={a.label}
            onClick={() => chooseAction(a.label)}
            style={{
              flex: '1 1 100px',
              padding: '12px 8px',
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--panel-bg-light)',
              border: '1px solid var(--panel-border)',
              borderRadius: 8,
            }}
          >
            {actionLabelJa(a.label)}
            {a.amountBb > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{a.amountBb.toFixed(1)}bb</div>}
          </button>
        ))}
      </div>

      {/* セッション状態 */}
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
        単発モード ・ {sessionTally.spots}問 ・ 正解{sessionTally.correct} ・ 累計EVロス {sessionTally.totalEvLossBb.toFixed(2)}bb
      </div>
    </div>
  )
}
