import { useAppStore } from '../store/state'
import type { AppView } from '../store/state'
import { SpadeIcon, ListIcon, BookIcon, BarChartIcon, HelpCircleIcon, TargetIcon } from './icons'

const TABS: { view: AppView; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { view: 'table',   label: 'テーブル', Icon: SpadeIcon },
  { view: 'history', label: '履歴',     Icon: ListIcon },
  { view: 'study',   label: '学習',     Icon: BookIcon },
  { view: 'stats',   label: '統計',     Icon: BarChartIcon },
  { view: 'quiz',    label: '一問一答', Icon: HelpCircleIcon },
  { view: 'gto',     label: 'GTO練習',  Icon: TargetIcon },
]

export function BottomNav() {
  const { view, setView } = useAppStore()

  return (
    <nav style={{
      display: 'flex',
      background: 'var(--panel-bg)',
      borderTop: '1px solid var(--panel-border)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      flexShrink: 0,
    }}>
      {TABS.map(({ view: v, label, Icon }) => {
        const active = view === v
        return (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3, padding: '8px 4px',
              background: 'transparent',
              color: active ? 'var(--gold-light)' : 'var(--text-dim)',
              borderRadius: 0,
              minHeight: 54,
            }}
          >
            <Icon size={active ? 22 : 20} />
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, lineHeight: 1 }}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
