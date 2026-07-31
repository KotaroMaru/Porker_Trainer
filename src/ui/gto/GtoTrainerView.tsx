import { useGtoStore, type GtoTab } from '../../gto/store'
import { PlayScreen } from './PlayScreen'
import { SettingsScreen } from './SettingsScreen'
import { BookmarksScreen } from './BookmarksScreen'
import { AnalyzerScreen } from './AnalyzerScreen'
import { DailyChallengeScreen } from './DailyChallengeScreen'
import { DivergenceScreen } from './DivergenceScreen'

// P4 Step D: サブ画面切替(QuizViewパターン)。
// P4は'play'のみ実装。P6 Step B9でsettingsを実装、B10でbookmarksを実装。
// P6 Step B10: タブ状態はローカルuseStateからstoreのactiveTabへ引き上げた
// (openBookmark/closeBookmarkがpropコールバックの受け渡し無しで直接タブ遷移できるようにするため)。

// P12 Phase A-3: 'range'/'tierquiz'は新GTOアプリ(GtoApp.tsx)専用のタブで、この旧アプリの
// タブ列(下の配列)には含めない。GtoTabがunion型であるためRecordは網羅する必要がある。
const MODE_LABELS: Record<GtoTab, string> = {
  play: 'プレイ',
  review: 'カスタム解析',
  bookmarks: '保存済み',
  settings: '設定',
  daily: 'デイリー',
  divergence: 'ズレ分析',
  range: 'レンジ表',
  tierquiz: '色当てクイズ',
}

export function GtoTrainerView() {
  const { activeTab, setActiveTab } = useGtoStore()

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ color: 'var(--gold)', fontSize: 18, flexShrink: 0 }}>GTO練習</h2>
        {/* P12 Phase A-1: whiteSpace/flexShrinkが無いとボタンが潰れて文字単位で折り返される
         *  (モバイルで縦書きに見えるバグの原因)。overflowXを機能させるにはこの親にminWidth:0も必要
         *  (flexアイテムの既定min-widthはcontentのため、無いと親自体が広がり横スクロールが起きない)。 */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', minWidth: 0, paddingBottom: 2 }}>
          {(['play', 'daily', 'review', 'bookmarks', 'divergence', 'settings'] as GtoTab[]).map((m) => (
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
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
      {activeTab === 'review' && <AnalyzerScreen />}
      {activeTab === 'daily' && <DailyChallengeScreen />}
      {activeTab === 'divergence' && <DivergenceScreen />}
    </div>
  )
}
