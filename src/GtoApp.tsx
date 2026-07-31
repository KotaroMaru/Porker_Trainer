import { useGtoStore } from './gto/store'
import type { GtoTab } from './gto/store'
import { useIsMobile } from './hooks/useIsMobile'
import { PlayScreen } from './ui/gto/PlayScreen'
import { SettingsScreen } from './ui/gto/SettingsScreen'
import { BookmarksScreen } from './ui/gto/BookmarksScreen'
import { AnalyzerScreen } from './ui/gto/AnalyzerScreen'
import { DailyChallengeScreen } from './ui/gto/DailyChallengeScreen'
import { DivergenceScreen } from './ui/gto/DivergenceScreen'
import { TierQuizTab } from './ui/gto/TierQuizTab'
import { YokosawaRangeSection } from './ui/study/YokosawaRangeSection'
import { TargetIcon, TrophyIcon, GridIcon, BookIcon, GearIcon } from './ui/icons'
import './index.css'

// P12 Phase A-3: GTO専用アプリのシェル。実利用が「GTO練習」「一問一答(色当て)」
// 「学習資料(レンジ表)」の3機能に絞られたため、旧App.tsx(テーブル/履歴/統計等の
// 6タブ構成)とは別に、GTOトレーニングを主役にした5タブ構成のシェルを新設する。
// 旧App.tsxとその配下のビューは削除せず、main.tsxの描画対象をこちらへ切り替えるだけ。
//
// storeのGtoTab(既存6値+P12で追加した'range'/'tierquiz')をそのままトップタブ⇄サブタブの
// 単一の真実として使う(状態の二重化を避ける)。グルーピング(どのGtoTabがどのトップタブに
// 属するか)はこのUI層だけが持つ派生値。

type TopGroup = 'play' | 'daily' | 'analyze' | 'study' | 'settings'

const GROUP_TABS: Record<TopGroup, readonly GtoTab[]> = {
  play: ['play'],
  daily: ['daily'],
  analyze: ['review', 'bookmarks', 'divergence'],
  study: ['range', 'tierquiz'],
  settings: ['settings'],
}

const GROUP_ORDER: TopGroup[] = ['play', 'daily', 'analyze', 'study', 'settings']

const GROUP_LABELS: Record<TopGroup, string> = {
  play: 'プレイ',
  daily: 'デイリー',
  analyze: '解析',
  study: '学習',
  settings: '設定',
}

const GROUP_ICONS: Record<TopGroup, React.ComponentType<{ size?: number }>> = {
  play: TargetIcon,
  daily: TrophyIcon,
  analyze: GridIcon,
  study: BookIcon,
  settings: GearIcon,
}

const SUB_TAB_LABELS: Partial<Record<GtoTab, string>> = {
  review: 'カスタム解析',
  bookmarks: '保存済み',
  divergence: 'ズレ分析',
  range: 'レンジ表',
  tierquiz: '色当てクイズ',
}

function groupOf(tab: GtoTab): TopGroup {
  for (const group of GROUP_ORDER) {
    if ((GROUP_TABS[group] as readonly GtoTab[]).includes(tab)) return group
  }
  return 'play'
}

export function GtoApp() {
  const { activeTab, setActiveTab } = useGtoStore()
  const isMobile = useIsMobile()
  const activeGroup = groupOf(activeTab)
  const subTabs = GROUP_TABS[activeGroup]

  function selectGroup(group: TopGroup) {
    if (group === activeGroup) return
    setActiveTab(GROUP_TABS[group][0])
  }

  const groupNavButtons = GROUP_ORDER.map((group) => {
    const Icon = GROUP_ICONS[group]
    const active = group === activeGroup
    return isMobile ? (
      <button
        key={group}
        onClick={() => selectGroup(group)}
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
        <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, lineHeight: 1 }}>{GROUP_LABELS[group]}</span>
      </button>
    ) : (
      <button
        key={group}
        onClick={() => selectGroup(group)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: active ? 'var(--green-mid)' : 'transparent',
          color: active ? 'var(--gold-light)' : 'var(--text-muted)',
          padding: '6px 16px',
          fontSize: 14,
          fontWeight: active ? 600 : 400,
          border: '1px solid ' + (active ? 'var(--green-light)' : 'var(--panel-border)'),
          borderRadius: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <Icon size={16} />
        {GROUP_LABELS[group]}
      </button>
    )
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <header style={{
        background: 'var(--panel-bg)',
        borderBottom: '1px solid var(--panel-border)',
        padding: '9px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        paddingTop: isMobile ? 'max(9px, env(safe-area-inset-top))' : 9,
      }}>
        <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <TargetIcon size={18} /> GTO Trainer
        </span>
        {!isMobile && (
          <nav style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            {groupNavButtons}
          </nav>
        )}
      </header>

      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto', width: '100%', flex: 1 }}>
          {subTabs.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', minWidth: 0, paddingBottom: 2 }}>
              {subTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: activeTab === tab ? 'var(--green-mid)' : 'transparent',
                    color: activeTab === tab ? 'var(--gold-light)' : 'var(--text-muted)',
                    padding: '6px 14px',
                    fontSize: 13.5,
                    fontWeight: activeTab === tab ? 600 : 400,
                    border: '1px solid ' + (activeTab === tab ? 'var(--green-light)' : 'var(--panel-border)'),
                    borderRadius: 6,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {SUB_TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'play' && <PlayScreen />}
          {activeTab === 'daily' && <DailyChallengeScreen />}
          {activeTab === 'review' && <AnalyzerScreen />}
          {activeTab === 'bookmarks' && <BookmarksScreen />}
          {activeTab === 'divergence' && <DivergenceScreen />}
          {activeTab === 'range' && <YokosawaRangeSection />}
          {activeTab === 'tierquiz' && <TierQuizTab />}
          {activeTab === 'settings' && <SettingsScreen />}
        </div>
      </main>

      {isMobile && (
        <nav style={{
          display: 'flex',
          background: 'var(--panel-bg)',
          borderTop: '1px solid var(--panel-border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          flexShrink: 0,
        }}>
          {groupNavButtons}
        </nav>
      )}
    </div>
  )
}
