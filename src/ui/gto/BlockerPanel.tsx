// P5 Step B8: 折りたたみパネル「ブロッカー分析」。自分の手札が相手のバリュー
// ハンド/継続レンジを何%ブロックしているかを表示する。

import type { SpotFeatures } from '../../gto/explain/features'
import type { Combo } from '../../analysis/range'
import { cardLabel } from '../../engine/deck'
import type { BlockedHand } from '../../gto/explain/features'

interface Props {
  blockers: SpotFeatures['blockers']
  userCombo: Combo
}

export function BlockerPanel({ blockers, userCombo }: Props) {
  return (
    <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        あなたの手({userCombo.map(cardLabel).join(' ')})は、相手のバリューハンドを
        <strong style={{ color: 'var(--gold-light)' }}> {blockers.valueCombosReducedPct.toFixed(0)}% </strong>
        ブロックしています。
      </div>
      {blockers.continueCombosReducedPct !== null && (
        <div>
          継続レンジ(fold以外)に対しては<strong style={{ color: 'var(--gold-light)' }}> {blockers.continueCombosReducedPct.toFixed(0)}% </strong>のブロック効果があります。
        </div>
      )}
      <BlockedHandList label="バリューハンド" hands={blockers.valueBlockedHands} />
      {blockers.continueBlockedHands !== null && <BlockedHandList label="継続レンジ" hands={blockers.continueBlockedHands} />}
    </div>
  )
}

function BlockedHandList({ label, hands }: { label: string; hands: readonly BlockedHand[] }) {
  if (hands.length === 0) return <div style={{ color: 'var(--text-dim)' }}>{label}にブロックしているハンドはありません。</div>

  return (
    <div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>{label}のブロック対象（全{hands.length}クラス）</div>
      <div style={{ maxHeight: 144, overflowY: 'auto', border: '1px solid var(--panel-border)', borderRadius: 4, padding: '3px 6px' }}>
        {hands.map(({ hand, comboCount, weightPct }) => (
          <div key={hand} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: '20px' }}>
            <span>{hand} <span style={{ color: 'var(--text-dim)' }}>({comboCount}コンボ)</span></span>
            <span style={{ color: 'var(--gold-light)' }}>{weightPct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
