// P13 Phase C-2: レビュー画面に「ベットの種類(バリュー/セミブラフ/ピュアブラフ/プロテクション)」と
// 「そのベットのターゲット(バリューなら誰からコールをもらうか、ブラフなら誰を降ろすか)」を
// 表示する専用パネル。データはfeatures.betTarget(既存)とbetKind.classifyBetKind(新規、
// 追加のエクイティ計算はしない)から組み立てる。ベット系アクションが無い/betTarget===nullの
// 場合はパネル自体を出さない。

import type { ReviewDecision } from '../../gto/trainer/reviewBuilder'
import type { SpotFeatures, BetActionTarget, BlockedHand } from '../../gto/explain/features'
import { classifyBetKind, type BetKind, type BetKindResult } from '../../gto/explain/betKind'
import { actionLabelJa } from './labels'

const KIND_LABEL_JA: Record<BetKind, string> = {
  value: 'バリューベット',
  semiBluff: 'セミブラフ',
  pureBluff: 'ピュアブラフ',
  protection: 'プロテクション',
}

const KIND_COLOR: Record<BetKind, string> = {
  value: 'var(--gold-light)',
  semiBluff: 'var(--green-light)',
  pureBluff: 'var(--red)',
  protection: 'var(--text-muted)',
}

function kindLabel(result: BetKindResult): string {
  const base = KIND_LABEL_JA[result.kind]
  if (result.kind === 'value' && result.valueThickness) {
    return `${base}(${result.valueThickness === 'thick' ? '厚め' : '薄め'})`
  }
  return base
}

interface Entry {
  roleJa: string
  label: string
  result: BetKindResult
  target: BetActionTarget | null
}

interface Props {
  decision: ReviewDecision
  features: SpotFeatures
}

export function BetIntentPanel({ decision, features }: Props) {
  if (features.betTarget === null) return null

  const chosenLabel = decision.chosenLabel
  const bestLabel = decision.grading.bestLabel
  const entries: Entry[] = []

  const chosenResult = classifyBetKind(chosenLabel, features)
  if (chosenResult) {
    entries.push({ roleJa: '選んだアクション', label: chosenLabel, result: chosenResult, target: features.betTarget.chosen })
  }
  if (bestLabel !== chosenLabel) {
    const bestResult = classifyBetKind(bestLabel, features)
    if (bestResult) {
      entries.push({ roleJa: '最善アクション', label: bestLabel, result: bestResult, target: features.betTarget.best })
    }
  }

  if (entries.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((entry) => (
        <div key={entry.label} style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {entry.roleJa}({actionLabelJa(entry.label)})
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                border: `1px solid ${KIND_COLOR[entry.result.kind]}`,
                color: KIND_COLOR[entry.result.kind],
              }}
            >
              {kindLabel(entry.result)}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 6 }}>{entry.result.reasonJa}</div>
          {entry.target && <TargetHandsView target={entry.target} />}
        </div>
      ))}
    </div>
  )
}

function TargetHandsView({ target }: { target: BetActionTarget }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <TargetHandLine label="バリューターゲット" hands={target.valueTargetHands} verbJa="からコールをもらいます" />
      <TargetHandLine label="ブラフターゲット" hands={target.bluffTargetHands} verbJa="を降ろします" />
    </div>
  )
}

function TargetHandLine({ label, hands, verbJa }: { label: string; hands: readonly BlockedHand[]; verbJa: string }) {
  if (hands.length === 0) return null
  const top = hands.slice(0, 3)
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      {label}: {top.map((h) => `${h.hand}(${h.weightPct.toFixed(0)}%)`).join('・')} {verbJa}
    </div>
  )
}
