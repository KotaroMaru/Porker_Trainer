import { useState } from 'react'
import { useAppStore } from '../store/state'
import type { HandRecord } from '../store/state'
import { betSizeVerdict } from '../advisor/explain'
import { ACTION_JA, STREET_JA } from './glossary'
import { CardView } from './CardView'
import { CoinIcon, WarningIcon, GearIcon, TargetIcon, CheckIcon, CrossIcon, ApproxIcon } from './icons'
import { TIER_INFO, YOKOSAWA_ACTION_JA } from '../advisor/yokosawa'
import { handString } from '../advisor/ranges'
import { YokosawaRangeGrid } from './YokosawaRangeGrid'

function pctOrDash(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

const toneColor = (t: 'good' | 'bad' | 'neutral') =>
  t === 'good' ? 'var(--green-light)' : t === 'bad' ? 'var(--red)' : 'var(--text-muted)'
const toneBg = (t: 'good' | 'bad' | 'neutral') =>
  t === 'good' ? 'rgba(58,153,96,0.14)' : t === 'bad' ? 'rgba(217,64,64,0.14)' : 'rgba(255,255,255,0.05)'

/** ある1手の判定を「判定パネルと同じ大きさ」でフル表示する (履歴の見返し用) */
export function JudgmentCard({ record }: { record: HandRecord }) {
  const [showRange, setShowRange] = useState(false)
  const showBotTypes = useAppStore(s => s.showBotTypes)
  const rec = record.recommendation
  const sv = record.userAction && (record.userAction.type === 'bet' || record.userAction.type === 'raise')
    ? betSizeVerdict({
        type: record.userAction.type, amount: record.userAction.amount,
        pot: record.potTotal, betLevel: record.betLevel, recFraction: rec?.betSizeFraction,
      })
    : null

  const yokoAdvice = record.street === 'PREFLOP_BETTING' ? record.yokosawaAdvice : null
  const yokoCtx = record.street === 'PREFLOP_BETTING' ? record.yokosawaCtx : null
  const yokoHand = (() => {
    if (!yokoAdvice || record.userHoleCards.length !== 2) return null
    const [c1, c2] = record.userHoleCards
    return handString(c1.rank, c2.rank, c1.suit === c2.suit)
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 状況 + 手札 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13.5, color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--gold-light)', fontWeight: 700 }}>{STREET_JA[record.street] ?? record.street}</span>
        {record.userHoleCards.length === 2 && (
          <span style={{ display: 'flex', gap: 3 }}>{record.userHoleCards.map((c, i) => <CardView key={i} card={c} size="sm" />)}</span>
        )}
        {record.board.length > 0 && (
          <span style={{ display: 'flex', gap: 3 }}>{record.board.map((c, i) => <CardView key={i} card={c} size="sm" />)}</span>
        )}
        <span style={{ marginLeft: 'auto', color: record.matched ? 'var(--green-light)' : 'var(--red)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          {record.matched ? <CheckIcon size={15} /> : <CrossIcon size={15} />}
          {record.matched ? '推奨どおり' : '推奨と不一致'}
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        あなたの選択: <strong style={{ color: 'var(--text)' }}>{ACTION_JA[record.userAction?.type ?? ''] ?? record.userAction?.type}</strong>
        {record.userAction && record.userAction.amount > 0 && ` ₱${record.userAction.amount}`}
        {'　/　ポット ₱'}{record.potTotal}
        {record.callAmount > 0 && `　/　コール額 ₱${record.callAmount}`}
      </div>

      {rec && (
        <>
          {/* 推奨アクション */}
          <div style={{ background: 'linear-gradient(160deg, var(--green-dark), #14301f)', borderRadius: 10, padding: 14, border: '1px solid var(--green-mid)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 4 }}>推奨アクション</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gold)' }}>
              {ACTION_JA[rec.action] ?? rec.action.toUpperCase()}
              {rec.betSizeFraction && (
                <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 8 }}>(ポットの約{Math.round(rec.betSizeFraction * 100)}%)</span>
              )}
            </div>
          </div>

          {/* 数値ブロック */}
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Cell label="あなたの読み" value={pctOrDash(rec.equity.estimate)} highlight />
            <Cell label="実際の勝率" value={pctOrDash(rec.equity.exact)} />
            <Cell label="必要勝率" value={`${Math.round(rec.equity.required * 100)}%`} />
          </div>

          {/* 判定 */}
          <Banner tone={rec.verdictTone} text={`判定: ${rec.verdictText}`} />

          {/* サイズ判定 */}
          {sv && <Banner tone={sv.tone} icon={<CoinIcon size={15} />} text={`サイズ判定: ${sv.text}`} />}

          {/* 解説 */}
          <div style={{ background: 'var(--panel-bg)', borderRadius: 10, padding: 13, border: '1px solid var(--panel-border)', fontSize: 14, lineHeight: 1.7, color: 'var(--text)' }}>
            {rec.explanation}
          </div>
          {rec.sizeRationale && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, display: 'flex', gap: 6 }}>
              <CoinIcon size={15} style={{ color: 'var(--gold-light)', marginTop: 2 }} />
              <span><strong style={{ color: 'var(--gold-light)' }}>サイズの根拠:</strong> {rec.sizeRationale}</span>
            </div>
          )}

          {/* ギャップ警告 */}
          {rec.gapWarning && (
            <div style={{ background: 'rgba(200,168,75,0.12)', borderRadius: 10, padding: 11, border: '1px solid rgba(200,168,75,0.4)', fontSize: 13, color: 'var(--gold-light)', lineHeight: 1.7, display: 'flex', gap: 7 }}>
              <WarningIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{rec.gapWarning}</span>
            </div>
          )}

          {/* 相手調整 (相手タイプ分析) — 「型表示」ON時のみ */}
          {showBotTypes && rec.exploitNote && (
            <div style={{ background: 'rgba(200,168,75,0.08)', borderRadius: 10, padding: 11, border: '1px solid rgba(200,168,75,0.2)', fontSize: 13, color: 'var(--gold-light)', lineHeight: 1.6, display: 'flex', gap: 7 }}>
              <GearIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{rec.exploitNote}</span>
            </div>
          )}
        </>
      )}

      {/* ===== ヨコサワモデル (プリフロップのみ) ===== */}
      {yokoAdvice && (
        <div style={{ background: 'linear-gradient(160deg, #20283f, #161d2e)', borderRadius: 10, padding: 13, border: '1px solid #34406a' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#9fb0e8', fontWeight: 700, letterSpacing: 0.5 }}>ヨコサワモデル</span>
            <button
              onClick={() => setShowRange(v => !v)}
              style={{ background: 'none', border: '1px solid #34406a', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'var(--gold)', cursor: 'pointer' }}
            >
              {showRange ? '▲ レンジ表を閉じる' : '▼ レンジ表を見る'}
            </button>
          </div>
          {/* 対レイズ時は「リレイズ判定」、それ以外は通常の参加判定 */}
          {yokoAdvice.assumedOpponentTier && (
            <div style={{ fontSize: 11.5, color: '#9fb0e8', fontWeight: 700, marginBottom: 6 }}>
              リレイズ判定（相手の色を予測）
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              background: TIER_INFO[yokoAdvice.tier].color,
              color: TIER_INFO[yokoAdvice.tier].textColor,
              borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700,
              border: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap',
            }}>
              あなた: {TIER_INFO[yokoAdvice.tier].labelJa}
            </span>
            {yokoAdvice.assumedOpponentTier && (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>vs</span>
                <span style={{
                  background: TIER_INFO[yokoAdvice.assumedOpponentTier].color,
                  color: TIER_INFO[yokoAdvice.assumedOpponentTier].textColor,
                  borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap',
                }}>
                  {yokoCtx?.raiserPosition ? `相手(${yokoCtx.raiserPosition})` : '相手'}（予測）: {TIER_INFO[yokoAdvice.assumedOpponentTier].labelJa}
                </span>
              </>
            )}
            <span style={{ fontSize: 17, fontWeight: 700, color: '#cdd6f4' }}>
              → {YOKOSAWA_ACTION_JA[yokoAdvice.action]}
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.65 }}>
            {yokoAdvice.reasoning}
          </div>
          {showRange && (
            <div style={{ marginTop: 12 }}>
              <YokosawaRangeGrid highlightHand={yokoHand ?? undefined} cellSize={26} />
            </div>
          )}
        </div>
      )}

      {/* 見積もり結果 */}
      {record.estimateResult && (
        <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: record.estimateResult.correct ? 'var(--green-light)' : 'var(--red)' }}>
          {record.estimateResult.correct ? <CheckIcon size={15} /> : record.estimateResult.adjacent ? <ApproxIcon size={15} /> : <CrossIcon size={15} />}
          <TargetIcon size={14} style={{ color: 'var(--text-muted)' }} />
          見積もり: {record.estimateResult.band} と回答 → 真値 {Math.round(record.estimateResult.trueEquity * 100)}%
          ({record.estimateResult.correct ? '正解' : record.estimateResult.adjacent ? '惜しい' : '不正解'})
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? 'rgba(200,168,75,0.1)' : 'rgba(255,255,255,0.04)',
      borderRadius: 8, padding: '8px 10px',
      border: `1px solid ${highlight ? 'rgba(200,168,75,0.35)' : 'transparent'}`,
    }}>
      <div style={{ fontSize: 11, color: highlight ? 'var(--gold-light)' : 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, margin: '2px 0', color: highlight ? 'var(--gold-light)' : 'var(--text)' }}>{value}</div>
    </div>
  )
}

function Banner({ tone, text, icon }: { tone: 'good' | 'bad' | 'neutral'; text: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      borderRadius: 10, padding: '10px 14px', fontSize: 13.5, fontWeight: 600, lineHeight: 1.5,
      background: toneBg(tone), border: `1px solid ${toneColor(tone)}`, color: toneColor(tone),
      display: 'flex', alignItems: 'center', gap: 7,
    }}>
      {icon}{text}
    </div>
  )
}
