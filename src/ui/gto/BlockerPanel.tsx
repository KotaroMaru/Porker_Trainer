// P5 Step B8: 折りたたみパネル「ブロッカー分析」。自分の手札が相手のバリュー
// ハンド/継続レンジを何%ブロックしているかを表示する。

import type { SpotFeatures } from '../../gto/explain/features'
import type { Combo } from '../../analysis/range'
import { cardLabel } from '../../engine/deck'

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
      {blockers.blockedExamples.length > 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>代表例: {blockers.blockedExamples.join(', ')}</div>
      ) : (
        <div style={{ color: 'var(--text-dim)' }}>ブロックしている代表的なコンボはありません。</div>
      )}
    </div>
  )
}
