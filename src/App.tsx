import { useEffect, useState, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from './store/state'
import type { BotSpeed, TableSize, JudgePanelSettings } from './store/state'
import { TableView } from './ui/TableView'
import { HistoryView } from './ui/HistoryView'
import { StudyView } from './ui/StudyView'
import { StatsView } from './ui/StatsView'
import { QuizView } from './ui/QuizView'
import { TutorialOverlay } from './ui/TutorialOverlay'
import { SpadeIcon, GearIcon } from './ui/icons'
import './index.css'

const SPEED_LABELS: Record<BotSpeed, string> = { fast: '速い', normal: '普通', slow: 'ゆっくり' }
const TABLE_SIZE_LABELS: Record<TableSize, string> = { 6: '6人', 7: '7人', 8: '8人' }

const JUDGE_SECTION_LABELS: Record<keyof JudgePanelSettings, string> = {
  rangeVsRange: 'レンジ対レンジ勝率',
  yokosawa: 'ヨコサワモデル',
  sizeJudge: 'サイズ判定',
  mistake: 'ミス警告',
  gapWarning: 'ギャップ警告',
  explanation: '解説',
  alternatives: '他の選択肢',
  handLog: '判断履歴',
}
const JUDGE_SECTION_KEYS = Object.keys(JUDGE_SECTION_LABELS) as (keyof JudgePanelSettings)[]

export function App() {
  const {
    view, setView, startNewGame, resetSession, game,
    toggleEstimateMode, toggleShowBotTypes,
    estimateMode, showBotTypes,
    botSpeed, setBotSpeed, tableSize, setTableSize, continuousPlay, toggleContinuousPlay,
    judgePanelSettings, toggleJudgePanelSetting,
  } = useAppStore()
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!game) startNewGame()
  }, [])

  // 設定ポップオーバーの外側クリックで閉じる
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header style={{
        background: 'var(--panel-bg)',
        borderBottom: '1px solid var(--panel-border)',
        padding: '9px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <SpadeIcon size={18} /> Poker Trainer
        </span>
        <nav style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {(['table', 'history', 'study', 'stats', 'quiz'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view === v ? 'var(--green-mid)' : 'transparent',
                color: view === v ? 'var(--gold-light)' : 'var(--text-muted)',
                padding: '6px 16px',
                fontSize: 14,
                fontWeight: view === v ? 600 : 400,
                border: '1px solid ' + (view === v ? 'var(--green-light)' : 'var(--panel-border)'),
              }}
            >
              {{ table: 'テーブル', history: '履歴', study: '学習資料', stats: '統計', quiz: '一問一答' }[v]}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 13, alignItems: 'center' }}>
          <Toggle label="見積もりモード" checked={estimateMode} onChange={toggleEstimateMode} />
          <Toggle label="型表示" checked={showBotTypes} onChange={toggleShowBotTypes} />

          {/* Settings popover */}
          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setSettingsOpen(o => !o)}
              title="設定"
              style={{
                background: settingsOpen ? 'var(--gold)' : 'var(--panel-bg-light)',
                color: settingsOpen ? '#1a2a1a' : 'var(--text-muted)',
                width: 30, height: 30, borderRadius: '50%',
                fontSize: 15, border: '1px solid var(--panel-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <GearIcon size={16} />
            </button>
            <AnimatePresence>
              {settingsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
                    borderRadius: 10, padding: 14, width: 250, zIndex: 50,
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex', flexDirection: 'column', gap: 12,
                    maxHeight: '80vh', overflowY: 'auto',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>テーブル人数 (次のハンドから)</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {([6, 7, 8] as TableSize[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setTableSize(s)}
                          style={{
                            flex: 1,
                            background: tableSize === s ? 'var(--gold)' : 'var(--panel-bg-light)',
                            color: tableSize === s ? '#1a2a1a' : 'var(--text-muted)',
                            border: '1px solid var(--panel-border)',
                            padding: '6px 4px', fontSize: 12.5, borderRadius: 6,
                            fontWeight: tableSize === s ? 700 : 500,
                          }}
                        >
                          {TABLE_SIZE_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>ボットの速度</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {(['fast', 'normal', 'slow'] as BotSpeed[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setBotSpeed(s)}
                          style={{
                            flex: 1,
                            background: botSpeed === s ? 'var(--gold)' : 'var(--panel-bg-light)',
                            color: botSpeed === s ? '#1a2a1a' : 'var(--text-muted)',
                            border: '1px solid var(--panel-border)',
                            padding: '6px 4px', fontSize: 12.5, borderRadius: 6,
                            fontWeight: botSpeed === s ? 700 : 500,
                          }}
                        >
                          {SPEED_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>連続プレイ</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        スタックを引き継ぎ、ボタンが時計回りに移動
                      </div>
                    </div>
                    <Toggle label="" checked={continuousPlay} onChange={toggleContinuousPlay} />
                  </div>

                  <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>判定パネルの表示</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {JUDGE_SECTION_KEYS.map(key => (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{JUDGE_SECTION_LABELS[key]}</span>
                          <Toggle
                            label=""
                            checked={judgePanelSettings[key]}
                            onChange={() => toggleJudgePanelSetting(key)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => { resetSession(); setSettingsOpen(false) }}
                    style={{
                      background: 'var(--red-dark)', color: '#ffd9d9',
                      padding: '7px 10px', fontSize: 12.5, borderRadius: 6,
                    }}
                  >
                    スタックをリセットして最初から
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setTutorialOpen(true)}
            title="使い方を見る"
            style={{
              background: 'var(--green-mid)', color: 'var(--gold-light)',
              width: 30, height: 30, borderRadius: '50%',
              fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ?
          </button>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        {view === 'table' && <TableView />}
        {view === 'history' && <HistoryView />}
        {view === 'study' && <StudyView />}
        {view === 'stats' && <StatsView />}
        {view === 'quiz' && <QuizView />}
      </main>

      <TutorialOverlay open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        color: checked ? 'var(--gold-light)' : 'var(--text-muted)',
        background: 'transparent', padding: 0, fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 32, height: 18, borderRadius: 9,
        background: checked ? 'var(--gold)' : 'var(--panel-border)',
        position: 'relative', transition: 'background 0.2s', display: 'inline-block',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </span>
      {label}
    </button>
  )
}
