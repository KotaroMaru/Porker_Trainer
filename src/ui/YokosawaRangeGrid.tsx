import { getYokosawaTier, TIER_INFO, TIER_ORDER, BB_BOUNDARY_HANDS } from '../advisor/yokosawa'
import type { YokosawaTier } from '../advisor/yokosawa'

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

interface Props {
  /** ハイライトするハンド表記 (例: 'AKs', 'QQ', 'T9o') */
  highlightHand?: string
  cellSize?: number
}

// ピンク枠(灰と白の境目)の色
const BOUNDARY_BORDER = '#e84393'

/** ヨコサワ色分け 13×13 レンジ表 */
export function YokosawaRangeGrid({ highlightHand, cellSize = 30 }: Props) {
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
      {RANKS.map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
          <div style={{ width: 18, fontSize: 10, color: 'var(--text-dim)', lineHeight: `${cellSize}px` }}>{RANKS[i]}</div>
          {RANKS.map((__, j) => {
            const hand = cellHand(i, j)
            const tier = getYokosawaTier(hand)
            const info = TIER_INFO[tier]
            const isHighlight = highlightHand === hand
            const isBoundary = BB_BOUNDARY_HANDS.has(hand)
            return (
              <div key={j} style={{
                width: cellSize, height: cellSize, borderRadius: 3,
                background: info.color,
                border: isBoundary
                  ? `2px solid ${BOUNDARY_BORDER}`
                  : '1px solid rgba(0,0,0,0.3)',
                fontSize: cellSize >= 30 ? 9 : 8,
                fontWeight: isBoundary ? 700 : 400,
                color: info.textColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                // 金の外周リング: outline は border の外側に描画されるためピンク枠と干渉しない
                outline: isHighlight ? '3px solid var(--gold)' : undefined,
                outlineOffset: isHighlight ? '1px' : undefined,
                boxShadow: isHighlight ? '0 0 6px 2px rgba(200,168,75,0.7)' : undefined,
                zIndex: isHighlight ? 1 : undefined,
                position: 'relative',
              }}>
                {hand}
              </div>
            )
          })}
        </div>
      ))}

      {/* 凡例: 7 ティア */}
      <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--text-muted)', alignItems: 'center', flexWrap: 'wrap' }}>
        {TIER_ORDER.map(t => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Swatch color={TIER_INFO[t].color} />
            {TIER_INFO[t].labelJa}
            <span style={{ color: 'var(--text-dim)', fontSize: 10.5 }}>
              {t === 'navy' ? '(8人/強)' : t === 'red' ? '(8人/弱)' : t === 'yellow' ? '(6〜7人)' : t === 'gray' ? '(不参加)' : `(${TIER_INFO[t].maxBehind}人以下)`}
            </span>
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Swatch color={TIER_INFO.gray.color} borderColor={BOUNDARY_BORDER} />
          境界(BTNレイズにBBコール可)
        </span>
        {highlightHand && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Swatch color={TIER_INFO[getYokosawaTier(highlightHand)].color} borderColor="var(--gold)" />
            あなたの手 ({highlightHand}) = {TIER_INFO[getYokosawaTier(highlightHand)].labelJa}
          </span>
        )}
      </div>
    </div>
  )
}

function Swatch({ color, borderColor }: { color: string; borderColor?: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12, background: color,
      border: borderColor ? `2px solid ${borderColor}` : '1px solid rgba(0,0,0,0.3)',
      borderRadius: 2, verticalAlign: 'middle',
    }} />
  )
}

// ティア順の強弱表示用に再エクスポート
export type { YokosawaTier }
