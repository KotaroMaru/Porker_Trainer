// P6 Step B9: 設定タブ。モード切替(単発/通し)+シナリオ別有効化チェックリスト
// (利用可否はavailability.tsで自動検出したmanifest.json情報を反映)。
// トグル/セグメントの見た目は既存画面のパターンをこのファイル内にローカル再実装する
// (App.tsx自体には触れない、既存5画面への非接触方針)。

import { useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { SCENARIOS } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import { MIN_FLOPS_FOR_PLAY } from '../../gto/loader/availability'
import type { Scenario } from '../../gto/types'
import type { GtoMode } from '../../gto/settings'

const MODE_OPTIONS: { value: GtoMode; label: string }[] = [
  { value: 'single', label: '単発' },
  { value: 'full', label: '通し' },
]

function groupLabel(s: Scenario): string {
  if (s.kind === 'THREEBET') return '3betポット'
  return s.defender.role === 'coldcaller' ? 'SRP: コールドコール' : 'SRP: vs BB'
}

interface AvailabilityBadge {
  label: string
  /** MIN_FLOPS_FOR_PLAY以上のフロップが生成済みで、出題プールに含められる状態か。 */
  playable: boolean
}

/** flopCountがundefined(manifest取得失敗/未生成)、またはMIN_FLOPS_FOR_PLAY未満は「未生成」扱いにする。 */
function availabilityBadge(flopCount: number | undefined): AvailabilityBadge {
  const total = FLOPS.length
  if (flopCount === undefined || flopCount < MIN_FLOPS_FOR_PLAY) return { label: '未生成', playable: false }
  if (flopCount >= total) return { label: `${flopCount}/${total}`, playable: true }
  return { label: `${flopCount}/${total} 生成中`, playable: true }
}

export function SettingsScreen() {
  const { settings, setMode, setScenarioEnabled, availability, loadAvailability } = useGtoStore()

  useEffect(() => {
    void loadAvailability()
  }, [loadAvailability])

  const groups = new Map<string, Scenario[]>()
  for (const s of SCENARIOS) {
    const g = groupLabel(s)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>プレイモード</div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden' }}>
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              style={{
                padding: '8px 20px',
                fontSize: 14,
                fontWeight: settings.mode === opt.value ? 600 : 400,
                background: settings.mode === opt.value ? 'var(--green-mid)' : 'transparent',
                color: settings.mode === opt.value ? 'var(--gold-light)' : 'var(--text-muted)',
                border: 'none',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
          出題シナリオ{availability === null && '(解データを確認中...)'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[...groups.entries()].map(([group, scenarios]) => (
            <div key={group}>
              <div style={{ fontSize: 12.5, color: 'var(--gold-light)', marginBottom: 6 }}>{group}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {scenarios.map((s) => {
                  const flopCount = availability?.get(s.id)?.length
                  const badge = availabilityBadge(flopCount)
                  const checked = settings.enabledScenarioIds.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'var(--panel-bg)',
                        opacity: badge.playable ? 1 : 0.5,
                        cursor: badge.playable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <input type="checkbox" checked={checked} disabled={!badge.playable} onChange={(e) => setScenarioEnabled(s.id, e.target.checked)} />
                      <span style={{ flex: 1, fontSize: 13.5 }}>{s.label}</span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'var(--panel-bg-light)',
                          color: badge.playable ? 'var(--green-light)' : 'var(--text-dim)',
                        }}
                      >
                        {badge.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
