// P11 Phase D-4: NF5「GTOズレ測定」の可視化タブ。store.divergenceTally(D-3で実プレイの
// 各決断ごとに積み上げ済み)をsummarizeDivergence(D-2、src/gto/stats/divergence.ts)で
// 表示用データへ変換し、fold(降り)/passive(受け)/aggressive(攻め)の3カテゴリで
// 「自分% vs GTO%」を横棒2本で対比表示する。見た目はStrategyMixBar/EquityDistChartと
// 同じ手法(幅%のdiv+actionColor流用)だが、ActionBreakdownEntry専用propsのそれらは
// そのまま使えないため新規に組む(タスクパケットの指示通り)。

import { useGtoStore } from '../../gto/store'
import { summarizeDivergence, type DivergenceBucketSummary } from '../../gto/stats/divergence'
import type { ActionBucket } from '../../gto/stats/actionBucket'
import { actionColor } from './actionColors'

/** 3カテゴリの日本語ラベル(タスクパケットで統一指定)。 */
const BUCKET_LABEL_JA: Record<ActionBucket, string> = {
  fold: '降り',
  passive: '受け',
  aggressive: '攻め',
}

/** 各カテゴリを代表する既存アクションラベル経由でactionColors.tsの配色を再利用する
 *  (バケット専用の新しい配色を追加せず、既存のポーカー標準配色に揃える)。 */
const BUCKET_REPRESENTATIVE_LABEL: Record<ActionBucket, string> = {
  fold: 'fold',
  passive: 'call',
  aggressive: 'raise55',
}

/** |diff|がこの値未満なら「GTOに近い」中立文言にする(Codex裁量の閾値、5%)。 */
const NEAR_GTO_THRESHOLD = 0.05
/** この決断数未満はサンプル数が少ないとみなす(タスクパケットで明記された要件)。 */
const LOW_SAMPLE_THRESHOLD = 30

function diffSentence(bucket: ActionBucket, diff: number): string {
  const label = BUCKET_LABEL_JA[bucket]
  if (Math.abs(diff) < NEAR_GTO_THRESHOLD) return `${label}はGTOに近い頻度です。`

  const pct = Math.abs(diff * 100).toFixed(0)
  const sign = diff > 0 ? '+' : '-'
  const direction = diff > 0 ? '多い' : '少ない'
  const hint =
    bucket === 'aggressive'
      ? diff > 0
        ? 'ベット・レイズしすぎ'
        : 'ベット・レイズが少なめ'
      : bucket === 'fold'
        ? diff > 0
          ? 'フォールドしすぎ'
          : 'フォールドが少なめ'
        : diff > 0
          ? 'チェック・コールが多め'
          : 'チェック・コールが少なめ'

  return `${label}が${sign}${pct}%${direction}(${hint})`
}

function BucketRow({ summary }: { summary: DivergenceBucketSummary }) {
  const { bucket, userRate, gtoRate, diff } = summary
  const color = actionColor(BUCKET_REPRESENTATIVE_LABEL[bucket])
  const userPct = userRate * 100
  const gtoPct = gtoRate * 100
  const maxPct = Math.max(1, userPct, gtoPct)
  const barWidth = (pct: number) => `${(pct / maxPct) * 100}%`

  return (
    <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 12, background: 'var(--panel-bg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{BUCKET_LABEL_JA[bucket]}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          自分 {(userRate * 100).toFixed(0)}% / GTO {(gtoRate * 100).toFixed(0)}%
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 32, fontSize: 10, color: 'var(--text-dim)' }}>自分</span>
          <div style={{ flex: 1, height: 14, background: 'var(--panel-bg-light)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: barWidth(userPct), height: '100%', background: color }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 32, fontSize: 10, color: 'var(--text-dim)' }}>GTO</span>
          <div style={{ flex: 1, height: 14, background: 'var(--panel-bg-light)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: barWidth(gtoPct), height: '100%', background: color, opacity: 0.5 }} />
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{diffSentence(bucket, diff)}</div>
    </div>
  )
}

export function DivergenceScreen() {
  const { divergenceTally, resetDivergenceStats } = useGtoStore()
  const summary = summarizeDivergence(divergenceTally)
  const lowSample = summary.count > 0 && summary.count < LOW_SAMPLE_THRESHOLD

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 620 }}>
      <h3 style={{ color: 'var(--gold)', margin: 0 }}>GTOズレ分析</h3>
      <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>
        通常プレイ・デイリーチャレンジ(カスタム解析・保存済みハンドの再閲覧を除く)の全決断を対象に、
        自分の選択傾向がGTO戦略の頻度分布からどれだけズレているかを、降り/受け/攻めの3カテゴリで表示します。
      </p>

      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        集計決断数: <strong style={{ color: 'var(--text)' }}>{summary.count}</strong>
      </div>
      {summary.count === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', border: '1px dashed var(--panel-border)', borderRadius: 8 }}>
          まだ集計対象の決断がありません。プレイするとここに表示されます。
        </div>
      )}
      {lowSample && (
        <div style={{ fontSize: 12, color: 'var(--gold)', padding: '6px 10px', border: '1px solid var(--panel-border)', borderRadius: 6, background: 'var(--panel-bg-light)' }}>
          サンプル数が少ないため参考程度です({LOW_SAMPLE_THRESHOLD}決断未満)。
        </div>
      )}

      {summary.count > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {summary.buckets.map((b) => (
            <BucketRow key={b.bucket} summary={b} />
          ))}
        </div>
      )}

      <button
        onClick={() => resetDivergenceStats()}
        style={{ alignSelf: 'start', padding: '8px 16px', background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--panel-border)', borderRadius: 6, fontSize: 12 }}
      >
        集計をリセット
      </button>
    </div>
  )
}
