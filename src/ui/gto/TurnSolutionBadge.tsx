// P15: ターンの解の出所を示すバッジ。
//
// 2種類を出し分けず、**その場で解析したときだけ**出す(ユーザー決定 2026-08-03)。
// 対象シナリオの全経路が収録されればバッジは自然に消えるため、
// バッジが出ること自体が「収録漏れの経路を踏んだ」というシグナルになる。
//
// 注意: これは採点精度の指標ではない。ターンのプレイ用25反復で粗くなるのは
// ボットの行動だけで、採点はREFINE_SOLVE(300反復・目標0.5%)の完了を待って
// 再収穫される(fullHandFlow.tsのfinishOrRefine)。説明文で「採点が正確になる」
// という趣旨を書かないこと。

import { useState } from 'react'
import type { TurnSolutionSource } from '../../gto/trainer/reviewBuilder'
import type { TurnFallbackReason } from '../../gto/trainer/fullHandFlow'

/**
 * なぜ事前計算を使えなかったかの内訳。退避は数値破綻を防ぐ正常系として黙って行われるため、
 * 理由を出さないと「特化モードなのにターンで計算が入る」の切り分けができない。
 */
const REASON_JA: Record<TurnFallbackReason, string> = {
  noFlopPath: 'フロップの経路を特定できませんでした。',
  notRecorded: 'この局面(シナリオまたはフロップの打ち方)は事前計算に含まれていません。',
  fetchFailed: '事前計算データの取得に失敗しました(通信・キャッシュ)。',
  comboMismatch: '事前計算データと手札の組み合わせ表が一致しませんでした。',
}

/** 表示テキストは1箇所に集約する(文言変更を1行で済ませるため)。 */
const BADGE_TEXT = '計算'
const DESCRIPTION = 'その場で解析した戦略を相手の行動に使用しました。採点の精度は事前計算の場合と変わりません。'

export function TurnSolutionBadge({ source, reason }: { source: TurnSolutionSource; reason?: TurnFallbackReason | null }) {
  const [expanded, setExpanded] = useState(false)

  // 事前計算が既定の状態。何も出さないことで「正常」を表す。
  if (source === 'precomputed') return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{
          padding: '3px 9px',
          borderRadius: 999,
          border: '1px dashed var(--panel-border)',
          background: 'var(--panel-bg)',
          color: 'var(--text-dim)',
          fontSize: 11.5,
          fontWeight: 500,
        }}
      >
        {BADGE_TEXT}
      </button>
      {expanded && (
        <div role="note" style={{ color: 'var(--text-dim)', fontSize: 11.5, textAlign: 'center' }}>
          {DESCRIPTION}
          {reason ? <div style={{ marginTop: 4 }}>{REASON_JA[reason]}</div> : null}
        </div>
      )}
    </div>
  )
}
