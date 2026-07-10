import { useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { buildPreflopScript } from '../../gto/trainer/preflopScript'
import { isOopPosition } from '../../gto/data/scenarios'
import { CardView } from '../CardView'
import type { GradeVerdict } from '../../gto/trainer/grading'

// P4 Step D: フロップ単発モードの最小プレイ画面(承認済みUIモック指針準拠)。
// 本格ReviewScreen+解説レイヤーはP5。

const ACTION_LABEL_JA: Record<string, string> = {
  check: 'チェック',
  fold: 'フォールド',
  call: 'コール',
  bet33: 'ベット 33%',
  bet75: 'ベット 75%',
  raise55: 'レイズ 55%',
  allin: 'オールイン',
}

const VERDICT_LABEL: Record<GradeVerdict, string> = {
  correct: '○ 正解',
  marginal: '△ 惜しい(境界上の手)',
  incorrect: '✕ 不正解',
}

const VERDICT_COLOR: Record<GradeVerdict, string> = {
  correct: 'var(--green-light)',
  marginal: 'var(--gold)',
  incorrect: 'var(--red)',
}

function actionLabelJa(label: string): string {
  return ACTION_LABEL_JA[label] ?? label
}

export function PlayScreen() {
  const { status, spot, grading, chosenLabel, sessionTally, errorMessage, startNewSpot, chooseAction, nextSpot } = useGtoStore()

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

  const oopIsRaiser = isOopPosition(spot.scenario.raiser.position, spot.scenario.defender.position)
  const oopPosition = oopIsRaiser ? spot.scenario.raiser.position : spot.scenario.defender.position
  const ipPosition = oopIsRaiser ? spot.scenario.defender.position : spot.scenario.raiser.position
  const userPosition = spot.userSeat === 0 ? oopPosition : ipPosition
  const botPosition = spot.userSeat === 0 ? ipPosition : oopPosition

  const preflopLines = buildPreflopScript(spot.scenario)
  const board = boardFromFlop(spot.flop)
  const graded = status === 'graded' && grading

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
          <div style={{ background: graded ? 'transparent' : 'var(--gold)', color: graded ? 'var(--text)' : '#000', display: 'inline-block', padding: '1px 6px', borderRadius: 4 }}>
            {userPosition}: {graded && chosenLabel ? actionLabelJa(chosenLabel) : '?'}
          </div>
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

      {/* アクションボタン or 採点結果 */}
      {!graded ? (
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
      ) : (
        <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: VERDICT_COLOR[grading.verdict], marginBottom: 4 }}>
            {VERDICT_LABEL[grading.verdict]}
            {grading.evLossBb > 0.01 && <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>EVロス -{grading.evLossBb.toFixed(2)}bb</span>}
          </div>
          <table style={{ width: '100%', fontSize: 12.5, marginTop: 8, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)' }}>
                <td>アクション</td>
                <td style={{ textAlign: 'right' }}>頻度</td>
                <td style={{ textAlign: 'right' }}>EV</td>
              </tr>
            </thead>
            <tbody>
              {grading.actionBreakdown.map((entry) => (
                <tr key={entry.label} style={{ color: entry.label === grading.bestLabel ? 'var(--gold-light)' : 'var(--text)' }}>
                  <td>
                    {entry.label === grading.bestLabel && '★ '}
                    {actionLabelJa(entry.label)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{(entry.freq * 100).toFixed(1)}%</td>
                  <td style={{ textAlign: 'right' }}>{entry.evBb.toFixed(2)}bb</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => void nextSpot()}
            style={{ marginTop: 12, width: '100%', padding: '10px', fontWeight: 600, background: 'var(--green-mid)', border: '1px solid var(--green-light)', borderRadius: 8, color: 'var(--gold-light)' }}
          >
            次のスポット
          </button>
        </div>
      )}

      {/* セッション状態 */}
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
        単発モード ・ {sessionTally.spots}問 ・ 正解{sessionTally.correct} ・ 累計EVロス {sessionTally.totalEvLossBb.toFixed(2)}bb
      </div>
    </div>
  )
}

const RANK_LABELS: Record<number, string> = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' }
function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank)
}
function suitSymbol(suit: string): string {
  return { c: '♣', d: '♦', h: '♥', s: '♠' }[suit] ?? suit
}
