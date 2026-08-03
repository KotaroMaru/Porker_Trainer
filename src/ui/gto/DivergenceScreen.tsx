import { useGtoStore } from '../../gto/store'
import {
  FLOP_PATHS,
  OTHER_FLOP_PATH,
  STREETS,
  TEXTURE_KEYS,
  classifyDivergence,
  summarizeDivergence,
  type DivergenceCell,
} from '../../gto/stats/divergence'
import { DivergencePlot } from './DivergencePlot'

const STREET_LABELS = { flop: 'フロップ', turn: 'ターン', river: 'リバー' } as const
const PATH_LABELS: Record<string, string> = Object.fromEntries(FLOP_PATHS.map((path) => [path, path]))
PATH_LABELS[OTHER_FLOP_PATH] = 'その他 / フロップで終了'
const TEXTURE_LABELS: Record<string, string> = {
  'monotone-unpaired': 'モノトーン・非ペア',
  'monotone-paired': 'モノトーン・ペア',
  'twoTone-unpaired': 'ツートーン・非ペア',
  'twoTone-paired': 'ツートーン・ペア',
  'rainbow-unpaired': 'レインボー・非ペア',
  'rainbow-paired': 'レインボー・ペア',
}

function pct(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(0)}%`
}

function CellCard({ label, cell }: { label: string; cell: DivergenceCell }) {
  const summary = summarizeDivergence(cell)
  return (
    <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: 10, background: 'var(--panel-bg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
        <strong style={{ color: 'var(--text)' }}>{label}</strong>
        <span style={{ color: 'var(--text-dim)' }}>n={summary.count} / fold可 n={summary.foldEligibleCount}</span>
      </div>
      <DivergencePlot point={summary.point} ready={summary.pointReady} compact />
      {summary.pointReady && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
          X {pct(summary.point.x)} / Y {pct(summary.point.y)} · {classifyDivergence(summary.point.x, summary.point.y)}
        </div>
      )}
    </div>
  )
}

function BreakdownSection({ title, cells }: { title: string; cells: { key: string; label: string; cell: DivergenceCell }[] }) {
  return (
    <section>
      <h4 style={{ color: 'var(--gold)', margin: '0 0 8px' }}>{title}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
        {cells.map(({ key, label, cell }) => <CellCard key={key} label={label} cell={cell} />)}
      </div>
    </section>
  )
}

export function DivergenceScreen() {
  const { divergenceTally: stats, resetDivergenceStats, settings } = useGtoStore()
  const summary = summarizeDivergence(stats)
  const focused = settings.focusScenarioId !== null && stats.focusTrajectory.scenarioId === settings.focusScenarioId
  const trajectory = focused ? stats.focusTrajectory.points : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
      <h3 style={{ color: 'var(--gold)', margin: 0 }}>GTOずれ分析</h3>
      <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: 13 }}>
        横軸は全決断での攻め頻度、縦軸はフォールドを選べる場面だけでの降り方をGTOと比較します。
      </p>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        集計決断数: <strong style={{ color: 'var(--text)' }}>{summary.count}</strong>
        {' · '}fold可能: <strong style={{ color: 'var(--text)' }}>{summary.foldEligibleCount}</strong>
      </div>

      {summary.count === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', border: '1px dashed var(--panel-border)', borderRadius: 8 }}>
          まだ集計対象の決断がありません。プレイするとここに表示されます。
        </div>
      ) : (
        <div style={{ border: '1px solid var(--panel-border)', borderRadius: 10, padding: 12, background: 'var(--panel-bg)' }}>
          <DivergencePlot point={summary.point} ready={summary.pointReady} trajectory={trajectory} />
          {summary.pointReady && (
            <div style={{ textAlign: 'center', color: 'var(--text)', fontSize: 13 }}>
              X {pct(summary.point.x)} / Y {pct(summary.point.y)} · <strong>{classifyDivergence(summary.point.x, summary.point.y)}</strong>
            </div>
          )}
          {stats.legacyDecisionCount > 0 && summary.foldEligibleCount < 30 && (
            <p style={{ color: 'var(--gold)', fontSize: 12, textAlign: 'center' }}>
              旧データ{stats.legacyDecisionCount}件の攻め軸は引き継ぎ済みです。フォールド軸は新方式で集計中です。
            </p>
          )}
          {settings.focusScenarioId === null && (
            <p style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center' }}>軌跡はシナリオ特化モードのときだけ表示します。</p>
          )}
        </div>
      )}

      <BreakdownSection title="ストリート別" cells={STREETS.map((key) => ({ key, label: STREET_LABELS[key], cell: stats.byStreet[key] }))} />
      <BreakdownSection title="フロップ経路別" cells={[...FLOP_PATHS, OTHER_FLOP_PATH].map((key) => ({ key, label: PATH_LABELS[key], cell: stats.byPath[key] }))} />
      <BreakdownSection title="ボードテクスチャ別" cells={TEXTURE_KEYS.map((key) => ({ key, label: TEXTURE_LABELS[key], cell: stats.byTexture[key] }))} />

      <button
        onClick={() => resetDivergenceStats()}
        style={{ alignSelf: 'start', padding: '8px 16px', background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--panel-border)', borderRadius: 6, fontSize: 12 }}
      >
        集計をリセット
      </button>
    </div>
  )
}
