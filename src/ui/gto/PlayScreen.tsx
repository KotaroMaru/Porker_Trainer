import { useEffect } from 'react'
import { useGtoStore, type SessionTally } from '../../gto/store'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { isOopPosition } from '../../gto/data/scenarios'
import { ReviewScreen } from './ReviewScreen'
import { ResultSummaryScreen } from './ResultSummaryScreen'
import { actionLabelJa } from './labels'
import { PokerTableView } from './PokerTableView'
import { ActionButtonRow } from './ActionButtonRow'
import { SingleSpotHistoryStrip, FullHandHistoryStrip } from './StreetHistoryStrip'
import { TurnSolutionBadge } from './TurnSolutionBadge'

// P4 Step D / P5 Step B9: プレイ画面。settings.modeで単発/通しの2実装に分岐する
// (P6 Step B8で通し=FullHandPlayScreenを追加。単発=SingleSpotPlayScreenは無変更)。
// P11 Phase A: フェルトテーブル描画・アクションボタン列を共有部品(PokerTableView/
// ActionButtonRow)へ切り出した(挙動不変)。
// P13 Phase A: ストリート別履歴ストリップを共有部品(StreetHistoryStrip)へ切り出した
// (挙動不変、DailyChallengeScreen.tsxでも使うため)。

export function PlayScreen() {
  const mode = useGtoStore((s) => s.settings.mode)
  return mode === 'full' ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FullHandPlayScreen />
    </div>
  ) : (
    <SingleSpotPlayScreen />
  )
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

  const board = boardFromFlop(spot.flop)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SingleSpotHistoryStrip
        scenario={spot.scenario}
        board={board}
        potBb={spot.scenario.potBb}
        userPosition={userPosition}
        botPosition={botPosition}
        botActionsBefore={spot.botActionsBefore}
      />

      {/* テーブル */}
      <PokerTableView
        board={board}
        heroCombo={spot.userCombo}
        heroPosition={userPosition}
        potBb={spot.scenario.potBb}
        villain={{
          position: botPosition,
          latestActionText:
            spot.botActionsBefore.length > 0 ? actionLabelJa(spot.botActionsBefore[spot.botActionsBefore.length - 1].label) : null,
        }}
      />

      {/* アクションボタン */}
      <ActionButtonRow actions={spot.actionsWithAmounts} onChoose={chooseAction} />

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FullHandHistoryStrip history={fullHand.history} currentStreet={fullHand.street} />

      {fullHand.street === 'turn' && fullHand.turnSolutionSource && <TurnSolutionBadge source={fullHand.turnSolutionSource} reason={fullHand.turnFallbackReason} />}

      {/* テーブル */}
      <PokerTableView
        board={fullHand.board}
        heroCombo={fullHand.userCombo}
        heroPosition={fullHand.userPosition}
        potBb={fullHand.potBb}
        villain={{
          position: fullHand.botPosition,
          latestActionText: actionChipLabel(fullHand.latestActions.find((a) => !a.isUser)),
        }}
        heroLatestActionText={actionChipLabel(fullHand.latestActions.find((a) => a.isUser))}
      />

      {/* アクションボタン、またはボット思考中の進捗表示。userTurn中はソルブ進行中でも
          ボタンは常に有効(木構造だけで決まるため、次街のライブソルブ完了を待つ必要がない)。 */}
      {status === 'botThinking' ? (
        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-dim)' }}>
          {fullHand.solvePhase === 'finalizing'
            ? 'まとめています…'
            : `相手が考え中…${fullHand.solveProgress !== null ? ` (解析 ${Math.round(fullHand.solveProgress * 100)}%)` : ''}`}
        </div>
      ) : (
        <ActionButtonRow actions={fullHand.actionsWithAmounts} onChoose={chooseAction} />
      )}

      <FullHandFooter sessionTally={sessionTally} />
    </div>
  )
}
