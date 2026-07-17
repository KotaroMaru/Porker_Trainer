import { createDeck, cardKey, cardLabel } from '../../engine/deck'
import type { Card } from '../../engine/types'

interface Props {
  selected: Card | null
  unavailable: readonly Card[]
  onSelect: (card: Card) => void
  ariaLabel: string
}

/** 既出カードを選べないようにする、カスタム解析用の最小カードピッカー。 */
export function CardPicker({ selected, unavailable, onSelect, ariaLabel }: Props) {
  const unavailableKeys = new Set(unavailable.map(cardKey))
  const selectedKey = selected ? cardKey(selected) : null
  return (
    <div aria-label={ariaLabel} style={{ display: 'grid', gridTemplateColumns: 'repeat(13, minmax(30px, 1fr))', gap: 3, maxWidth: 560 }}>
      {createDeck().map((card) => {
        const key = cardKey(card)
        const disabled = unavailableKeys.has(key)
        const active = selectedKey === key
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(card)}
            aria-pressed={active}
            style={{ padding: '5px 2px', borderRadius: 4, border: `1px solid ${active ? 'var(--gold)' : 'var(--panel-border)'}`, background: active ? 'var(--green-mid)' : 'var(--panel-bg)', color: disabled ? 'var(--text-dim)' : card.suit === 'h' || card.suit === 'd' ? 'var(--red)' : 'var(--text)', opacity: disabled ? 0.4 : 1, fontSize: 12 }}
          >
            {cardLabel(card)}
          </button>
        )
      })}
    </div>
  )
}
