import { useMemo, useState } from 'react'
import { DAILY_HAND_COUNT, computeDailyScore, dailyDateKey } from '../../gto/dailyChallenge/dailyChallenge'
import { loadDailyResults } from '../../gto/dailyChallenge/storage'
import { useGtoStore } from '../../gto/store'
import type { GtoMode } from '../../gto/settings'
import { isOopPosition } from '../../gto/data/scenarios'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { PokerTableView } from './PokerTableView'
import { ActionButtonRow } from './ActionButtonRow'
import { ReviewScreen } from './ReviewScreen'
import { actionLabelJa } from './labels'
import { SingleSpotHistoryStrip, FullHandHistoryStrip } from './StreetHistoryStrip'

// P11 Phase C: デイリーチャレンジを単発/通し両モードに対応させ、1問(単発)/1ハンド(通し)
// ごとにレビュー画面を挟むよう拡張した(store.ts側でphase:'idle'|'playing'|'reviewing'|'done'
// の4段階に拡張済み)。プレイ中の盤面はPhase A/Bで整備済みの共有部品(PokerTableView/
// ActionButtonRow)を使い、単発の自前簡易盤面(旧実装)は廃止した。
// P13 Phase A: プリフロップの行動が表示されていなかった不具合を、PlayScreen.tsxと共通の
// StreetHistoryStrip(P13 Phase Aで抽出)を追加することで解消した。

function RecentScores() {
  const results = useMemo(() => loadDailyResults(), [])
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (29 - index))
    const key = dailyDateKey(date)
    return { key, score: results[key]?.score ?? null }
  })
  return (
    <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>直近30日スコア</div>
      <div aria-label="直近30日スコア" style={{ height: 76, display: 'flex', alignItems: 'end', gap: 3 }}>
        {days.map(({ key, score }) => (
          <div key={key} title={`${key}: ${score ?? '未挑戦'}`} style={{ flex: 1, minWidth: 3, height: `${score ?? 5}%`, background: score === null ? 'var(--panel-border)' : score >= 50 ? 'var(--green-light)' : 'var(--red)', borderRadius: '2px 2px 0 0' }} />
        ))}
      </div>
    </div>
  )
}

/** 場(フェルト)に表示する「アクション名+金額」のチップ用ラベル(PlayScreen.tsxのFullHandPlayScreenと同じ規約)。 */
function actionChipLabel(a: { label: string; amountBb: number } | undefined): string | null {
  if (!a) return null
  return actionLabelJa(a.label) + (a.amountBb > 0 ? ` ${a.amountBb.toFixed(1)}bb` : '')
}

function ModePicker({ value, onChange }: { value: GtoMode; onChange: (mode: GtoMode) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {(['single', 'full'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--panel-border)',
            background: value === m ? 'var(--green-mid)' : 'transparent',
            color: value === m ? 'var(--gold-light)' : 'var(--text-dim)',
            fontWeight: value === m ? 700 : 400,
          }}
        >
          {m === 'single' ? '単発モード' : '通しモード'}
        </button>
      ))}
    </div>
  )
}

export function DailyChallengeScreen() {
  const { dailyChallenge, dailyRank, startDailyChallenge, chooseAction, dismissDailyReview, spot, fullHand, status, errorMessage } = useGtoStore()
  const [selectedMode, setSelectedMode] = useState<GtoMode>('single')
  const today = dailyDateKey()
  const summary = dailyChallenge?.results.length ? computeDailyScore(dailyChallenge.results) : null

  if (dailyChallenge?.phase === 'playing' && status === 'error') {
    return <div style={{ padding: 24, textAlign: 'center' }}><p style={{ color: 'var(--red)' }}>問題の読み込みに失敗しました。</p><p style={{ color: 'var(--text-dim)' }}>{errorMessage}</p></div>
  }

  // 単発モード: プレイ中
  if (dailyChallenge?.phase === 'playing' && dailyChallenge.mode === 'single') {
    if (!spot || status === 'loading') {
      return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>次の問題を読み込み中...</div>
    }
    const oopIsRaiser = isOopPosition(spot.scenario.raiser.position, spot.scenario.defender.position)
    const oopPosition = oopIsRaiser ? spot.scenario.raiser.position : spot.scenario.defender.position
    const ipPosition = oopIsRaiser ? spot.scenario.defender.position : spot.scenario.raiser.position
    const userPosition = spot.userSeat === 0 ? oopPosition : ipPosition
    const botPosition = spot.userSeat === 0 ? ipPosition : oopPosition
    const board = boardFromFlop(spot.flop)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{dailyChallenge.handIndex + 1}/{dailyChallenge.totalHands}問目 ・ 単発モード</div>
        <SingleSpotHistoryStrip
          scenario={spot.scenario}
          board={board}
          potBb={spot.scenario.potBb}
          userPosition={userPosition}
          botPosition={botPosition}
          botActionsBefore={spot.botActionsBefore}
        />
        <PokerTableView
          board={board}
          heroCombo={spot.userCombo}
          heroPosition={userPosition}
          potBb={spot.scenario.potBb}
          villain={{
            position: botPosition,
            latestActionText: spot.botActionsBefore.length > 0 ? actionLabelJa(spot.botActionsBefore[spot.botActionsBefore.length - 1].label) : null,
          }}
        />
        <ActionButtonRow actions={spot.actionsWithAmounts} onChoose={chooseAction} />
      </div>
    )
  }

  // 通しモード: プレイ中
  if (dailyChallenge?.phase === 'playing' && dailyChallenge.mode === 'full') {
    if (!fullHand || status === 'loading') {
      return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>次のハンドを読み込み中...</div>
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{dailyChallenge.handIndex + 1}/{dailyChallenge.totalHands}問目 ・ 通しモード</div>
        <FullHandHistoryStrip history={fullHand.history} currentStreet={fullHand.street} />
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
        {status === 'botThinking' ? (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-dim)' }}>
            {fullHand.solvePhase === 'finalizing'
              ? 'まとめています…'
              : `相手が考え中…${fullHand.solveProgress !== null ? ` (解析 ${Math.round(fullHand.solveProgress * 100)}%)` : ''}`}
          </div>
        ) : (
          <ActionButtonRow actions={fullHand.actionsWithAmounts} onChoose={chooseAction} />
        )}
      </div>
    )
  }

  // 単発・通し共通: 1問/1ハンドごとのレビュー画面
  if (dailyChallenge?.phase === 'reviewing') {
    const isLast = dailyChallenge.handIndex >= dailyChallenge.totalHands
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{dailyChallenge.handIndex}/{dailyChallenge.totalHands}問目 完了</div>
        <ReviewScreen />
        <button
          onClick={() => dismissDailyReview()}
          style={{ alignSelf: 'center', padding: '10px 22px', background: 'var(--green-mid)', color: 'var(--gold-light)', border: '1px solid var(--green-light)', borderRadius: 6, fontWeight: 600 }}
        >
          {isLast ? '結果を見る' : '次のハンドへ'}
        </button>
      </div>
    )
  }

  if (dailyChallenge?.phase === 'done') {
    const stored = loadDailyResults()[dailyChallenge.dateKey]
    const result = summary ? { ...summary, handCount: dailyChallenge.totalHands } : (stored ?? null)
    const change = dailyChallenge.ratingAfter === null ? 0 : dailyChallenge.ratingAfter - dailyChallenge.ratingBefore
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 620 }}>
        <h3 style={{ color: 'var(--gold)', margin: 0 }}>本日のチャレンジ完了</h3>
        <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 16, background: 'var(--panel-bg-light)' }}>
          <div style={{ fontSize: 28, color: 'var(--gold-light)', fontWeight: 700 }}>スコア {result?.score ?? 0}</div>
          <div>正解 {result?.correctCount ?? 0}/{result?.handCount ?? DAILY_HAND_COUNT} ・ EVロス合計 {(result?.totalEvLossBb ?? 0).toFixed(2)}bb</div>
          <div style={{ marginTop: 8 }}>ランク {dailyRank} <span style={{ color: change >= 0 ? 'var(--green-light)' : 'var(--red)' }}>({change >= 0 ? '↑' : '↓'}{Math.abs(change)})</span></div>
        </div>
        <RecentScores />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 620 }}>
      <h3 style={{ color: 'var(--gold)', margin: 0 }}>本日のチャレンジ（{DAILY_HAND_COUNT}問）</h3>
      <p style={{ color: 'var(--text-dim)', margin: 0 }}>毎日固定の10問で、正解率とEVロスからスコアを計算します。同じ日は一度だけ挑戦できます。</p>
      <div style={{ fontSize: 18 }}>現在のランク: <span style={{ color: 'var(--gold-light)', fontWeight: 700 }}>{dailyRank}</span></div>
      <ModePicker value={selectedMode} onChange={setSelectedMode} />
      <button onClick={() => void startDailyChallenge(selectedMode)} style={{ alignSelf: 'start', padding: '10px 22px', background: 'var(--green-mid)', color: 'var(--gold-light)', border: '1px solid var(--green-light)', borderRadius: 6 }}>今日のチャレンジを開始</button>
      <RecentScores />
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>日付: {today}</div>
    </div>
  )
}
