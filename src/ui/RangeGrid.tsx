import { getOpenRangeGrid, getVsRaiseRangeGrid } from '../advisor/ranges'
import type { Position } from '../engine/types'

const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']

interface Props {
  position: Position
  /** 'open' = オープンレンジ / 'vsraise' = 対レイズ (3bet/コール/フォールド) */
  mode?: 'open' | 'vsraise'
  /** ハイライトするハンド表記 (例: 'AKs', 'QQ', 'T9o') */
  highlightHand?: string
  cellSize?: number
}

const CELL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  open:  { bg: 'var(--green-light)', border: 'var(--green-mid)', text: '#fff' },
  '3bet': { bg: '#c0392b', border: '#922f22', text: '#fff' },
  call:  { bg: 'var(--green-light)', border: 'var(--green-mid)', text: '#fff' },
  fold:  { bg: 'var(--panel-bg)', border: 'var(--panel-border)', text: 'var(--text-dim)' },
}

/** 13×13 レンジグリッド */
export function RangeGrid({ position, mode = 'open', highlightHand, cellSize = 30 }: Props) {
  const grid = mode === 'open' ? getOpenRangeGrid(position) : getVsRaiseRangeGrid(position)

  function cellHand(i: number, j: number): string {
    if (i === j) return RANKS[i] + RANKS[j]
    if (i < j) return RANKS[i] + RANKS[j] + 's'
    return RANKS[j] + RANKS[i] + 'o'
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
        <div style={{ width: 18 }} />
        {RANKS.map(r => (
          <div key={r} style={{ width: cellSize, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>{r}</div>
        ))}
      </div>
      {grid.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
          <div style={{ width: 18, fontSize: 10, color: 'var(--text-dim)', lineHeight: `${cellSize}px` }}>{RANKS[i]}</div>
          {row.map((cell, j) => {
            const hand = cellHand(i, j)
            const isHighlight = highlightHand === hand
            const colors = CELL_COLORS[cell] ?? CELL_COLORS.fold
            return (
              <div key={j} style={{
                width: cellSize, height: cellSize, borderRadius: 3,
                background: isHighlight ? 'var(--gold)' : colors.bg,
                border: isHighlight ? '2px solid var(--gold-light)' : `1px solid ${colors.border}`,
                fontSize: cellSize >= 30 ? 9 : 8,
                fontWeight: isHighlight ? 700 : 400,
                color: isHighlight ? '#1a2a1a' : colors.text,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isHighlight ? 'var(--glow-gold)' : undefined,
              }}>
                {hand}
              </div>
            )
          })}
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)', alignItems: 'center', flexWrap: 'wrap' }}>
        {mode === 'open' ? (
          <span><Swatch color="var(--green-light)" />レイズで参加</span>
        ) : (
          <>
            <span><Swatch color="#c0392b" />3ベット</span>
            {position === 'BB' && <span><Swatch color="var(--green-light)" />コール (BBのみ)</span>}
          </>
        )}
        <span><Swatch color="var(--panel-bg)" bordered />フォールド</span>
        {highlightHand && (
          <span><Swatch color="var(--gold)" />あなたの手 ({highlightHand})</span>
        )}
      </div>
    </div>
  )
}

function Swatch({ color, bordered }: { color: string; bordered?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 11, height: 11, background: color,
      border: bordered ? '1px solid var(--panel-border)' : undefined,
      borderRadius: 2, verticalAlign: 'middle', marginRight: 4,
    }} />
  )
}
