// P14 L3: interpretSpot済みのbetProfileを描画するだけのパネル。分類ロジックは持たない。

import type { ActionTargets, BlockedHand } from '../../gto/explain/features'
import { BET_PROFILE_LABEL_JA, type BetProfile } from '../../gto/explain/interpretation'
import { actionLabelJa } from './labels'

const KIND_COLOR: Record<BetProfile['kind'], string> = {
  value: 'var(--gold-light)',
  semiBluff: 'var(--green-light)',
  pureBluff: 'var(--red)',
  protection: 'var(--text-muted)',
}

interface Props {
  profile: BetProfile | null
  target: ActionTargets | null
}

export function BetIntentPanel({ profile, target }: Props) {
  if (!profile) return null
  const base = BET_PROFILE_LABEL_JA[profile.kind]
  const label = profile.kind === 'value' && profile.valueThickness ? `${base}(${profile.valueThickness === 'thick' ? '厚め' : '薄め'})` : base
  return (
    <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>推奨アクション({actionLabelJa(profile.forLabel)})</span>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: `1px solid ${KIND_COLOR[profile.kind]}`, color: KIND_COLOR[profile.kind] }}>
          {label}
        </span>
      </div>
      {target && <TargetHandsView profile={profile} target={target} />}
    </div>
  )
}

function TargetHandsView({ profile, target }: { profile: BetProfile; target: ActionTargets }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {(profile.targetsToShow === 'continueWeak' || profile.targetsToShow === 'both') && (
        <TargetHandLine label="コールして残るが現時点で劣るハンド" hands={target.continueWeakHands} />
      )}
      {(profile.targetsToShow === 'folded' || profile.targetsToShow === 'both') && <TargetHandLine label="降ろせるハンド" hands={target.foldedHands} />}
    </div>
  )
}

function TargetHandLine({ label, hands }: { label: string; hands: readonly BlockedHand[] }) {
  if (hands.length === 0) return null
  return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}: {hands.slice(0, 3).map((hand) => `${hand.hand}(${hand.weightPct.toFixed(0)}%)`).join('・')}</div>
}
