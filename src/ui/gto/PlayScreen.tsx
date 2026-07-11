import { useEffect } from 'react'
import { useGtoStore, type SessionTally } from '../../gto/store'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { buildPreflopScript } from '../../gto/trainer/preflopScript'
import { isOopPosition } from '../../gto/data/scenarios'
import type { Street, HistoryEntry } from '../../gto/trainer/reviewBuilder'
import { CardView } from '../CardView'
import { ReviewScreen } from './ReviewScreen'
import { ResultSummaryScreen } from './ResultSummaryScreen'
import { actionLabelJa, rankLabel, suitSymbol, STREET_LABEL_JA } from './labels'
import { actionColor } from './actionColors'

// P4 Step D / P5 Step B9: プレイ画面。settings.modeで単発/通しの2実装に分岐する
// (P6 Step B8で通し=FullHandPlayScreenを追加。単発=SingleSpotPlayScreenは無変更)。

// P7-1: アクションボタンをレビュー画面と同じ配色(actionColors.ts)で塗り分ける
// (check=緑/call=フェルト緑/fold=青/bet系=赤濃淡)。全ての実装済み背景色に対し
// 白文字が十分なコントラストを持つことをindex.cssの値で確認済み。
function actionButtonStyle(label: string): React.CSSProperties {
  return {
    flex: '1 1 100px',
    padding: '12px 8px',
    fontSize: 14,
    fontWeight: 600,
    background: actionColor(label),
    color: '#fff',
    border: '1px solid rgba(0,0,0,0.25)',
    borderRadius: 8,
  }
}

export function PlayScreen() {
  const mode = useGtoStore((s) => s.settings.mode)
  return mode === 'full' ? <FullHandPlayScreen /> : <SingleSpotPlayScreen />
}

// ============================================================
// 単発モード(P4/P5、無変更)
// ============================================================

function SingleSpotPlayScreen() {
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

  if (status === 'graded') {
    // ブックマークを開いた場合はspotがnull(通常の単発フローを経由していない)ため、
    // 下のspotガードより必ず先にこの分岐へ来る必要がある。
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ReviewScreen />
        <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
          単発モード ・ {sessionTally.spots}問 ・ 正解{sessionTally.correct} ・ 累計EVロス {sessionTally.totalEvLossBb.toFixed(2)}bb
        </div>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CardView faceDown size="sm" />
          <CardView faceDown size="sm" />
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>{botPosition}</span>
          {spot.botActionsBefore.length > 0 && <ActionChip text={actionLabelJa(spot.botActionsBefore[spot.botActionsBefore.length - 1].label)} />}
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
          <button key={a.label} onClick={() => chooseAction(a.label)} style={actionButtonStyle(a.label)}>
            {actionLabelJa(a.label)}
            {a.amountBb > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 400 }}>{a.amountBb.toFixed(1)}bb</div>}
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

// ============================================================
// 通しモード(P6 Step B8)
// ============================================================

// P7-2: 場(フェルト)に表示する「アクション名+金額」のチップ用ラベルを作る
// (checkやfoldはamountBb===0なので金額を出さない、actionMath.tsの規約通り)。
function actionChipLabel(a: { label: string; amountBb: number } | undefined): string | null {
  if (!a) return null
  return actionLabelJa(a.label) + (a.amountBb > 0 ? ` ${a.amountBb.toFixed(1)}bb` : '')
}

function ActionChip({ text }: { text: string }) {
  return (
    <span
      data-testid="action-chip"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gold-light)',
        background: 'rgba(0,0,0,0.35)',
        padding: '2px 8px',
        borderRadius: 10,
        marginLeft: 6,
      }}
    >
      {text}
    </span>
  )
}

function FullHandFooter({ sessionTally }: { sessionTally: SessionTally }) {
  const netSign = sessionTally.totalNetBb > 0 ? '+' : ''
  return (
    <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
      通しモード ・ {sessionTally.hands}ハンド ・ 決断{sessionTally.decisions} ・ 正解{sessionTally.correct} ・ 収支 {netSign}
      {sessionTally.totalNetBb.toFixed(1)}bb
    </div>
  )
}

function FullHandPlayScreen() {
  const { status, fullHand, sessionTally, errorMessage, startNewSpot, chooseAction } = useGtoStore()

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

  if (status === 'graded') {
    // openReviewFromResult()呼び出し後、またはブックマークを開いた場合(この場合fullHandは
    // nullのまま)に到達する。単発モードと共通のReviewScreenへ合流する(ReviewScreen.tsxは
    // モードを意識せずstore.reviewだけを見て描画する)。fullHand.phaseは
    // openReviewFromResult()後も'over'のまま保持され続けるため、必ずこのstatusチェックを
    // fullHand.phase==='over'チェック・下のfullHandガードより先に行う(でないとレビューへ
    // 遷移できなくなる/ブックマークを開いた際に空白になる、実際に踏んだバグ)。
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ReviewScreen />
        <FullHandFooter sessionTally={sessionTally} />
      </div>
    )
  }

  if ((status === 'idle' || status === 'loading') && !fullHand) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>読み込み中...</div>
  }

  if (!fullHand) return null

  if (fullHand.phase === 'over') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ResultSummaryScreen />
        <FullHandFooter sessionTally={sessionTally} />
      </div>
    )
  }

  // 履歴をストリートごとにグループ化して列を作る(preflop/flop/turn/riverの出現順)。
  const grouped = new Map<Street, HistoryEntry[]>()
  for (const entry of fullHand.history) {
    if (!grouped.has(entry.street)) grouped.set(entry.street, [])
    grouped.get(entry.street)!.push(entry)
  }
  if (!grouped.has(fullHand.street)) grouped.set(fullHand.street, []) // 遷移直後、まだ誰も行動していない列も表示する

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ストリート別履歴ストリップ(preflop+到達済みの各街) */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden', fontSize: 13, overflowX: 'auto' }}>
        {[...grouped.entries()].map(([street, lines]) => (
          <div
            key={street}
            style={{
              flex: '1 0 90px',
              padding: 8,
              borderRight: '1px solid var(--panel-border)',
              background: street === fullHand.street ? 'var(--panel-bg-light)' : undefined,
            }}
          >
            <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>{STREET_LABEL_JA[street]}</div>
            {lines.map((line, i) => (
              <div key={i} style={{ color: line.isUserDecision ? 'var(--gold-light)' : 'var(--text)' }}>
                {line.position}: {street === 'preflop' ? line.label : actionLabelJa(line.label)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* テーブル */}
      <div style={{ background: 'var(--green-felt)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CardView faceDown size="sm" />
          <CardView faceDown size="sm" />
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>{fullHand.botPosition}</span>
          {(() => {
            const text = actionChipLabel(fullHand.latestActions.find((a) => !a.isUser))
            return text && <ActionChip text={text} />
          })()}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ color: 'var(--gold-light)', fontSize: 14 }}>ポット {fullHand.potBb.toFixed(1)}bb</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {fullHand.board.map((c, i) => (
              <div key={i} style={{ border: '2px solid var(--gold)', borderRadius: 6 }}>
                <CardView card={c} size="md" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginRight: 6 }}>{fullHand.userPosition}(あなた)</span>
          <CardView card={fullHand.userCombo[0]} size="sm" />
          <CardView card={fullHand.userCombo[1]} size="sm" />
          {(() => {
            const text = actionChipLabel(fullHand.latestActions.find((a) => a.isUser))
            return text && <ActionChip text={text} />
          })()}
        </div>
      </div>

      {/* アクションボタン、またはボット思考中の進捗表示。userTurn中はソルブ進行中でも
          ボタンは常に有効(木構造だけで決まるため、次街のライブソルブ完了を待つ必要がない)。 */}
      {status === 'botThinking' ? (
        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-dim)' }}>
          相手が考え中…{fullHand.solveProgress !== null && ` (解析 ${Math.round(fullHand.solveProgress * 100)}%)`}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {fullHand.actionsWithAmounts.map((a) => (
            <button key={a.label} onClick={() => chooseAction(a.label)} style={actionButtonStyle(a.label)}>
              {actionLabelJa(a.label)}
              {a.amountBb > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 400 }}>{a.amountBb.toFixed(1)}bb</div>}
            </button>
          ))}
        </div>
      )}

      <FullHandFooter sessionTally={sessionTally} />
    </div>
  )
}
