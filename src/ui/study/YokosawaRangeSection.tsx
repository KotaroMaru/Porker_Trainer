import { YokosawaRangeGrid } from '../YokosawaRangeGrid'
import { TIER_INFO, TIER_DISPLAY_ORDER } from '../../advisor/yokosawa'

// P12 Phase A-2: StudyView.tsx(旧アプリ「学習資料」)にあった「ヨコサワレンジ表」
// セクションを、新GTOアプリの「学習」タブからも同じ実装で使えるよう共有モジュールへ
// 抽出した。挙動・見た目は移設元から不変。

export function Intro({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 14, lineHeight: 1.8, color: 'var(--text-muted)',
      background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 16px',
      borderLeft: '3px solid var(--gold)', marginBottom: 20,
    }}>
      {children}
    </p>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ color: 'var(--gold)', fontSize: 19, marginBottom: 12 }}>{children}</h2>
}

export function YokosawaRangeSection() {
  return (
    <section>
      <SectionTitle>ヨコサワレンジ表</SectionTitle>
      <Intro>
        「世界のヨコサワ」オリジナルのハンドレンジ表です。手の強さを<strong>8色のティア（段階）</strong>で表し、
        ポジション（後ろの人数）に応じて参加・フォールドを判断します。
        まずこの表で自分の手が何色かを確認しましょう。
      </Intro>
      <div style={{ overflowX: 'auto' }}>
        <YokosawaRangeGrid cellSize={34} />
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionTitle>各ティアの意味</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {TIER_DISPLAY_ORDER.map(t => {
            const info = TIER_INFO[t]
            const behindLabel =
              t === 'navy' ? '常に参加(8人/強)' :
              t === 'red' ? '常に参加(8人/弱)' :
              t === 'yellow' ? '後ろ6〜7人以下で参加' :
              t === 'green' ? '後ろ4〜5人以下で参加' :
              t === 'lightblue' ? '後ろ3人以下で参加' :
              t === 'white' ? '後ろ2人以下で参加' :
              t === 'pink' ? '境界：BTNのレイズにBBだけコール可' :
              '参加しない（フォールド）'
            return (
              <div key={t} style={{
                background: 'var(--panel-bg)', borderRadius: 8, padding: '10px 14px',
                border: `2px solid ${info.color}`, display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6, background: info.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: info.textColor, fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>{info.labelJa}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{behindLabel}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
