// P6 Step B8: 通しモードのハンド終了時サマリー画面。fullHand.phase==='over'の間、
// PlayScreen.tsxがReviewScreenの代わりにこれを表示する。「レビューする」で
// store.openReviewFromResult()を呼び、単発モードと共通のReviewScreenへ遷移する。

import { useGtoStore } from '../../gto/store'
import { CardView } from '../CardView'
import { STREET_LABEL_JA, VERDICT_COLOR, actionLabelJa } from './labels'

function verdictMark(verdict: 'correct' | 'marginal' | 'incorrect'): string {
  return verdict === 'correct' ? '○' : verdict === 'marginal' ? '△' : '✕'
}

export function ResultSummaryScreen() {
  const { fullHand, openReviewFromResult, nextSpot } = useGtoStore()

  if (!fullHand || fullHand.phase !== 'over' || !fullHand.result) return null
  const { result, userSeat, userCombo, userPosition, botPosition, refining } = fullHand

  const netColor = result.userNetBb > 0 ? 'var(--green-light)' : result.userNetBb < 0 ? 'var(--red)' : 'var(--text-dim)'
  const netSign = result.userNetBb > 0 ? '+' : ''

  const outcomeLine =
    result.endedBy === 'fold'
      ? `${result.foldedSeat === userSeat ? 'あなた' : '相手'}(${result.foldedSeat === userSeat ? userPosition : botPosition})のフォールドで終了`
      : 'ショーダウン'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', padding: '16px 0', border: '2px solid var(--gold)', boxShadow: 'var(--glow-gold)', borderRadius: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>{outcomeLine}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: netColor }}>
          {netSign}
          {result.userNetBb.toFixed(2)}bb
        </div>
      </div>

      {/* ボード+ショーダウン時の両者の手(フォールド時はボットの手を開示しない) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 0' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {result.finalBoard.map((c, i) => (
            <CardView key={i} card={c} size="sm" />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{userPosition}(あなた)</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <CardView card={userCombo[0]} size="sm" />
              <CardView card={userCombo[1]} size="sm" />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{botPosition}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {result.botCombo ? (
                <>
                  <CardView card={result.botCombo[0]} size="sm" />
                  <CardView card={result.botCombo[1]} size="sm" />
                </>
              ) : (
                <>
                  <CardView faceDown size="sm" />
                  <CardView faceDown size="sm" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 決断ごとのverdictチップ(街+○△✕+EVロス) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {result.decisionSummaries.map((d, i) => (
          <div
            key={i}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--panel-border)',
              background: 'var(--panel-bg-light)',
              color: VERDICT_COLOR[d.verdict],
            }}
          >
            {STREET_LABEL_JA[d.street]} {verdictMark(d.verdict)} {actionLabelJa(d.chosenLabel)}
            {d.evLossBb > 0.01 && ` -${d.evLossBb.toFixed(2)}bb`}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
        {result.decisionSummaries.length}決断中 正解{result.decisionSummaries.filter((d) => d.verdict === 'correct').length}
      </div>

      {/* P7-6b: ターンはプレイ用に粗くソルブしているため、ハンド終了後にバックグラウンドで
          精密再ソルブしている間はその旨を伝える(完了するとverdict/EVロスが更新されうる)。 */}
      {refining && <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>ターンを精密解析中…</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => openReviewFromResult()}
          style={{ flex: 2, padding: 10, fontWeight: 600, background: 'var(--green-mid)', border: '1px solid var(--green-light)', borderRadius: 8, color: 'var(--gold-light)' }}
        >
          レビューする
        </button>
        <button
          onClick={() => void nextSpot()}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel-bg-light)' }}
        >
          次のハンド
        </button>
      </div>
    </div>
  )
}
