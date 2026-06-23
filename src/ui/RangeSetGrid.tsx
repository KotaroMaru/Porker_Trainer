const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']

interface Props {
  /** レンジに含まれるハンド表記の集合 (例: {'AKs','TT','AQo',...}) */
  hands: Set<string>
  /** ハイライトするハンド表記 (例: 'AKs') */
  highlightHand?: string
  cellSize?: number
  /** 塗る色 (既定: 緑) */
  fillColor?: string
  fillBorder?: string
}

/** 任意の Set<string> ハンドレンジを 13×13 グリッドで描く汎用コンポーネント。 */
export function RangeSetGrid({
  hands, highlightHand, cellSize = 22,
  fillColor = 'var(--green-light)', fillBorder = 'var(--green-mid)',
}: Props) {
  function cellHand(i: number, j: number): string {
    if (i === j) return RANKS[i] + RANKS[j]
    if (i < j) return RANKS[i] + RANKS[j] + 's'
    return RANKS[j] + RANKS[i] + 'o'
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <div style={{ display: 'flex', gap: 1, marginBottom: 1 }}>
        <div style={{ width: 14 }} />
        {RANKS.map(r => (
          <div key={r} style={{ width: cellSize, fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>{r}</div>
        ))}
      </div>
      {RANKS.map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 1, marginBottom: 1 }}>
          <div style={{ width: 14, fontSize: 9, color: 'var(--text-dim)', lineHeight: `${cellSize}px` }}>{RANKS[i]}</div>
          {RANKS.map((_, j) => {
            const hand = cellHand(i, j)
            const isHighlight = highlightHand === hand
            const isIn = hands.has(hand)
            return (
              <div key={j} style={{
                width: cellSize, height: cellSize, borderRadius: 2,
                background: isHighlight ? 'var(--gold)' : isIn ? fillColor : 'var(--panel-bg)',
                border: isHighlight ? '2px solid var(--gold-light)' : `1px solid ${isIn ? fillBorder : 'var(--panel-border)'}`,
                fontSize: cellSize >= 24 ? 8 : 7,
                fontWeight: isHighlight ? 700 : 400,
                color: isHighlight ? '#1a2a1a' : isIn ? '#fff' : 'var(--text-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {hand}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
