import { useAppStore } from '../store/state'

export function StatsView() {
  const { sessionStats, handHistory, hintCount } = useAppStore()

  const totalDecisions = handHistory.length
  const matchCount = handHistory.filter(r => r.matched).length
  const matchRate = totalDecisions > 0 ? matchCount / totalDecisions : 0

  // ハンド単位の収支 (userNet はハンド終了時に各レコードへ確定値が入る)
  const handNets = new Map<number, number>()
  for (const r of handHistory) {
    if (r.userNet !== undefined) handNets.set(r.handNumber, r.userNet)
  }
  const handCount = new Set(handHistory.map(r => r.handNumber)).size
  const netBB = [...handNets.values()].reduce((s, v) => s + v, 0) / 50

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--gold)', fontSize: 18, marginBottom: 20 }}>セッション統計</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <StatCard label="プレイしたハンド数" value={String(handCount)}
          note={`判断回数: ${totalDecisions}`}
        />
        <StatCard label="推奨一致率" value={`${Math.round(matchRate * 100)}%`}
          note={`${matchCount} / ${totalDecisions} 判断`}
          ok={matchRate >= 0.7}
        />
        <StatCard label="収支 (BB)" value={`${netBB >= 0 ? '+' : ''}${netBB.toFixed(1)} BB`}
          ok={netBB >= 0}
        />
        <StatCard label="ヒント使用回数" value={String(hintCount)}
          note={totalDecisions > 0 ? `${Math.round(hintCount / totalDecisions * 100)}% の判断で使用` : ''}
        />
        <StatCard label="見積もり精度" value={
          sessionStats.estimateTotal > 0
            ? `${Math.round(sessionStats.estimateAccuracy * 100)}%`
            : '—'
        }
          note={sessionStats.estimateTotal > 0
            ? `${sessionStats.estimateCorrect} / ${sessionStats.estimateTotal} 問正解`
            : '見積もりモード中のみ計測'}
        />
      </div>

      {totalDecisions === 0 && (
        <p style={{ marginTop: 24, color: 'var(--text-dim)', fontSize: 14 }}>
          まだハンドが記録されていません。テーブルタブからゲームを始めてください。
        </p>
      )}

      {matchRate < 0.6 && totalDecisions >= 5 && (
        <div style={{
          marginTop: 20, background: 'rgba(217,64,64,0.1)', borderRadius: 8, padding: 14,
          border: '1px solid rgba(217,64,64,0.3)', fontSize: 13, color: 'var(--text)',
        }}>
          <strong style={{ color: 'var(--red)' }}>要注意:</strong> 推奨一致率が60%未満です。
          学習資料タブのレンジ表やポットオッズ計算を復習しましょう。
          不一致ハンドは履歴タブの「不一致のみ」フィルタで確認できます。
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, note, ok }: { label: string; value: string; note?: string; ok?: boolean }) {
  return (
    <div style={{
      background: 'var(--panel-bg)', borderRadius: 10, padding: '14px 16px',
      border: '1px solid var(--panel-border)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 700,
        color: ok === true ? 'var(--green-light)' : ok === false ? 'var(--red)' : 'var(--gold)',
      }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{note}</div>}
    </div>
  )
}
