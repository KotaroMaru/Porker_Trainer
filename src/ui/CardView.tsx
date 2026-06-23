import type { Card } from '../engine/types'
import { rankName, suitSymbol } from '../engine/deck'

interface Props {
  card?: Card
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  highlight?: boolean   // 役を構成するカードを強調
  dimmed?: boolean      // 役に使われていないカードを控えめに
}

const sizes = {
  sm: { width: 36, height: 50, fontSize: 15, suitSize: 12 },
  md: { width: 48, height: 67, fontSize: 19, suitSize: 16 },
  lg: { width: 62, height: 87, fontSize: 25, suitSize: 21 },
  xl: { width: 72, height: 100, fontSize: 30, suitSize: 25 },
}

export function CardView({ card, faceDown, size = 'md', highlight, dimmed }: Props) {
  const { width, height, fontSize, suitSize } = sizes[size]
  const isRed = card?.suit === 'h' || card?.suit === 'd'

  if (faceDown || !card) {
    return (
      <div style={{
        width, height,
        borderRadius: Math.max(5, width * 0.1),
        background: 'linear-gradient(135deg, #1a4a2a 0%, #0f2a1a 100%)',
        border: '1px solid #3a6a4a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <span style={{ color: '#3a6a4a', fontSize: suitSize }}>♠</span>
      </div>
    )
  }

  return (
    <div style={{
      width, height,
      borderRadius: Math.max(5, width * 0.1),
      background: 'linear-gradient(160deg, #fff 0%, var(--card-bg) 70%)',
      border: highlight ? '2px solid var(--gold)' : '1px solid #bbb',
      display: 'flex', flexDirection: 'column',
      alignItems: 'flex-start', justifyContent: 'flex-start',
      padding: highlight ? '2px 5px' : '3px 6px',
      boxShadow: highlight ? '0 0 0 2px var(--gold-light), var(--glow-gold)' : 'var(--shadow-sm)',
      color: isRed ? 'var(--card-red)' : 'var(--card-black)',
      opacity: dimmed ? 0.4 : 1,
      transform: highlight ? 'translateY(-4px)' : undefined,
      transition: 'opacity 0.3s, transform 0.3s, box-shadow 0.3s',
      userSelect: 'none',
    }}>
      <div style={{ fontSize, fontWeight: 700, lineHeight: 1 }}>
        {rankName(card.rank)}
      </div>
      <div style={{ fontSize: suitSize, lineHeight: 1.1 }}>
        {suitSymbol(card.suit)}
      </div>
    </div>
  )
}
