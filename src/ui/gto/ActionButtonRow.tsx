import type { CSSProperties } from 'react'
import { actionLabelJa } from './labels'
import { actionColor } from './actionColors'

// P11 Phase A: PlayScreen.tsxのSingleSpotPlayScreen・FullHandPlayScreen双方にあった
// 同一のアクションボタン列描画(actionButtonStyle関数+actions.map)を共通化した
// (挙動・スタイル値は不変)。

// P7-1: アクションボタンをレビュー画面と同じ配色(actionColors.ts)で塗り分ける
// (check=緑/call=フェルト緑/fold=青/bet系=赤濃淡)。全ての実装済み背景色に対し
// 白文字が十分なコントラストを持つことをindex.cssの値で確認済み。
function actionButtonStyle(label: string): CSSProperties {
  return {
    flex: '1 1 100px',
    padding: '12px 8px',
    fontSize: 14,
    fontWeight: 600,
    background: actionColor(label),
    color: '#fff',
    border: '1px solid rgba(0,0,0,0.25)',
    borderRadius: 8,
  }
}

interface Props {
  actions: { label: string; amountBb: number }[]
  onChoose: (label: string) => void
}

export function ActionButtonRow({ actions, onChoose }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a) => (
        <button key={a.label} onClick={() => onChoose(a.label)} style={actionButtonStyle(a.label)}>
          {actionLabelJa(a.label)}
          {a.amountBb > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 400 }}>{a.amountBb.toFixed(1)}bb</div>}
        </button>
      ))}
    </div>
  )
}
