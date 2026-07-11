import { useGtoStore, type GtoTab } from '../../gto/store'
import { PlayScreen } from './PlayScreen'
import { SettingsScreen } from './SettingsScreen'
import { BookmarksScreen } from './BookmarksScreen'

// P4 Step D: サブ画面切替(QuizViewパターン)。
// P4は'play'のみ実装。P6 Step B9でsettingsを実装、B10でbookmarksを実装。
// P6 Step B10: タブ状態はローカルuseStateからstoreのactiveTabへ引き上げた
// (openBookmark/closeBookmarkがpropコールバックの受け渡し無しで直接タブ遷移できるようにするため)。

const MODE_LABELS: Record<GtoTab, string> = {
  play: 'プレイ',
  review: 'レビュー',
  bookmarks: '保存済み',
  settings: '設定',
}

export function GtoTrainerView() {
  const { activeTab, setActiveTab } = useGtoStore()

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--gold)', fontSize: 18, flexShrink: 0 }}>GTO練習</h2>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 1, paddingBottom: 2 }}>
          {(['play', 'review', 'bookmarks', 'settings'] as GtoTab[]).map((m) => (
            <button
              key={m}
              onClick={() => setActiveTab(m)}
              style={{
                background: activeTab === m ? 'var(--green-mid)' : 'transparent',
                color: activeTab === m ? 'var(--gold-light)' : 'var(--text-muted)',
                padding: '6px 14px',
                fontSize: 13.5,
                fontWeight: activeTab === m ? 600 : 400,
                border: '1px solid ' + (activeTab === m ? 'var(--green-light)' : 'var(--panel-border)'),
                borderRadius: 6,
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'play' && <PlayScreen />}
      {activeTab === 'settings' && <SettingsScreen />}
      {activeTab === 'bookmarks' && <BookmarksScreen />}
      {activeTab === 'review' && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>
          {MODE_LABELS[activeTab]}はまだ実装されていません(今後のフェーズで追加予定)。
        </div>
      )}
    </div>
  )
}
