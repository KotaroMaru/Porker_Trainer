// P5 Step B8: 折りたたみパネル「エクイティ分布」。10バケットのペア棒グラフ
// (自分=gold、相手=--text-dim)+レンジ優位/ナッツ優位のverdict行。チャート
// ライブラリは使わずdivのみで描画する(プロジェクト内に既存のチャート実装がないため)。

import type { EquityBucket } from '../../gto/explain/features'

interface AdvantageSummary {
  verdictJa: string
}

interface Props {
  buckets: EquityBucket[]
  rangeAdvantage: AdvantageSummary & { heroAvg: number; villainAvg: number }
  nutsAdvantage: AdvantageSummary & { heroTopPct: number; villainTopPct: number }
}

export function EquityDistChart({ buckets, rangeAdvantage, nutsAdvantage }: Props) {
  const maxPct = Math.max(1, ...buckets.map((b) => Math.max(b.heroPct, b.villainPct)))

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        レンジ優位: <strong style={{ color: 'var(--text)' }}>{rangeAdvantage.verdictJa}</strong>(自分平均{(rangeAdvantage.heroAvg * 100).toFixed(0)}%
        / 相手平均{(rangeAdvantage.villainAvg * 100).toFixed(0)}%) ・ ナッツ優位: <strong style={{ color: 'var(--text)' }}>{nutsAdvantage.verdictJa}</strong>
        (自分{nutsAdvantage.heroTopPct.toFixed(0)}% / 相手{nutsAdvantage.villainTopPct.toFixed(0)}%)
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 100 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', gap: 1, alignItems: 'flex-end', height: '100%' }}>
            <div
              title={`自分 ${b.lo}-${b.hi}%: ${b.heroPct.toFixed(0)}%`}
              style={{ flex: 1, height: `${Math.max(0, (b.heroPct / maxPct) * 100)}%`, background: 'var(--gold)', borderRadius: '2px 2px 0 0' }}
            />
            <div
              title={`相手 ${b.lo}-${b.hi}%: ${b.villainPct.toFixed(0)}%`}
              style={{ flex: 1, height: `${Math.max(0, (b.villainPct / maxPct) * 100)}%`, background: 'var(--text-dim)', borderRadius: '2px 2px 0 0' }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, fontSize: 8, color: 'var(--text-dim)', textAlign: 'center' }}>
            {b.lo}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--gold)', display: 'inline-block', borderRadius: 2 }} /> 自分
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--text-dim)', display: 'inline-block', borderRadius: 2 }} /> 相手
        </div>
      </div>
    </div>
  )
}
