import { useMemo } from 'react'
import { DAILY_HAND_COUNT, computeDailyScore, dailyDateKey } from '../../gto/dailyChallenge/dailyChallenge'
import { loadDailyResults } from '../../gto/dailyChallenge/storage'
import { useGtoStore } from '../../gto/store'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { CardView } from '../CardView'
import { actionColor } from './actionColors'
import { actionLabelJa, rankLabel, suitSymbol } from './labels'

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

export function DailyChallengeScreen() {
  const { dailyChallenge, dailyRank, startDailyChallenge, chooseAction, spot, status, errorMessage } = useGtoStore()
  const today = dailyDateKey()
  const summary = dailyChallenge?.results.length ? computeDailyScore(dailyChallenge.results) : null

  if (dailyChallenge?.phase === 'playing' && status === 'error') {
    return <div style={{ padding: 24, textAlign: 'center' }}><p style={{ color: 'var(--red)' }}>問題の読み込みに失敗しました。</p><p style={{ color: 'var(--text-dim)' }}>{errorMessage}</p></div>
  }
  if (dailyChallenge?.phase === 'playing' && (!spot || status === 'loading')) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>次の問題を読み込み中...</div>
  }
  if (dailyChallenge?.phase === 'playing' && spot) {
    const board = boardFromFlop(spot.flop)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{dailyChallenge.handIndex + 1}/{dailyChallenge.totalHands}問目</div>
        <div style={{ background: 'var(--green-felt)', borderRadius: 10, padding: 18, textAlign: 'center' }}>
          <div style={{ color: 'var(--gold-light)', marginBottom: 10 }}>ポット {spot.scenario.potBb}bb</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>{board.map((card, i) => <CardView key={i} card={card} size="md" />)}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>あなた</span><CardView card={spot.userCombo[0]} size="sm" /><CardView card={spot.userCombo[1]} size="sm" /></div>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>ボード: {board.map((card) => `${rankLabel(card.rank)}${suitSymbol(card.suit)}`).join(' ')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {spot.actionsWithAmounts.map((action) => <button key={action.label} onClick={() => chooseAction(action.label)} style={{ flex: '1 1 100px', padding: '12px 8px', background: actionColor(action.label), color: '#fff', borderRadius: 8, border: '1px solid rgba(0,0,0,.25)', fontWeight: 600 }}>{actionLabelJa(action.label)}</button>)}
        </div>
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
      <button onClick={() => void startDailyChallenge()} style={{ alignSelf: 'start', padding: '10px 22px', background: 'var(--green-mid)', color: 'var(--gold-light)', border: '1px solid var(--green-light)', borderRadius: 6 }}>今日のチャレンジを開始</button>
      <RecentScores />
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>日付: {today}</div>
    </div>
  )
}
