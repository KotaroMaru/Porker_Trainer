import { createDeck, cardKey, cardLabel } from '../../engine/deck'
import type { Card } from '../../engine/types'

interface Props {
  /** 選択済みカード(複数選択対応、P11 Phase B)。トグル判定は呼び出し側の責務
   *  (クリックされたカードをそのままonSelectへ渡すだけ)。 */
  selected: readonly Card[]
  unavailable: readonly Card[]
  /** 選択可能枚数の上限。この上限に達したときの挙動(追加選択を無視するか等)は
   *  呼び出し側のonSelectハンドラが決める(手札ピッカーは無視、ターン/リバー
   *  ピッカーはクリック即差し替え)。ここではaria-multiselectableの算出にのみ使う。 */
  maxSelect: number
  onSelect: (card: Card) => void
  ariaLabel: string
}

/** 既出カードを選べないようにする、カスタム解析用の最小カードピッカー。 */
export function CardPicker({ selected, unavailable, maxSelect, onSelect, ariaLabel }: Props) {
  const unavailableKeys = new Set(unavailable.map(cardKey))
  const selectedKeys = new Set(selected.map(cardKey))
  return (
    <div
      aria-label={ariaLabel}
      aria-multiselectable={maxSelect > 1}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(13, minmax(30px, 1fr))', gap: 3, maxWidth: 560 }}
    >
      {createDeck().map((card) => {
        const key = cardKey(card)
        const disabled = unavailableKeys.has(key)
        const active = selectedKeys.has(key)
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
