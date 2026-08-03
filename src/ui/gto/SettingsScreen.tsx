// P6 Step B9: 設定タブ。モード切替(単発/通し)+シナリオ別有効化チェックリスト
// (利用可否はavailability.tsで自動検出したmanifest.json情報を反映)。
// トグル/セグメントの見た目は既存画面のパターンをこのファイル内にローカル再実装する
// (App.tsx自体には触れない、既存5画面への非接触方針)。

import { useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { SCENARIOS } from '../../gto/data/scenarios'
import { FLOPS } from '../../gto/data/flops'
import { MIN_FLOPS_FOR_PLAY } from '../../gto/loader/availability'
import { focusEligibleScenarioIds } from '../../gto/loader/turnBundleSource'
import type { Scenario } from '../../gto/types'
import type { GtoMode } from '../../gto/settings'

const MODE_OPTIONS: { value: GtoMode; label: string }[] = [
  { value: 'single', label: '単発' },
  { value: 'full', label: '通し' },
]

/**
 * P15 特化モード: 出題を1シナリオへ固定し、ターン以降の事前計算解を使う。
 *
 * プレイ画面ではなく設定画面へ置く(プレイ中に常時見えている必要がなく、
 * 画面を圧迫するため)。状態はスイッチの見た目とラベルの両方で示す。
 * 対応シナリオが増えたらセレクトへ変える。現状は1つなのでトグルで足りる。
 */
function FocusModeToggle() {
  const { settings, setFocusScenario } = useGtoStore()
  const targetId = focusEligibleScenarioIds()[0]
  const target = SCENARIOS.find((s) => s.id === targetId)
  if (!target) return null

  const on = settings.focusScenarioId === target.id

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>特化モード</div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="特化モード"
        onClick={() => setFocusScenario(on ? null : target.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          border: `1px solid ${on ? 'var(--gold)' : 'var(--panel-border)'}`,
          borderRadius: 8,
          background: on ? 'rgba(200,168,75,0.12)' : 'transparent',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            flex: '0 0 auto',
            width: 34,
            height: 20,
            borderRadius: 999,
            background: on ? 'var(--gold)' : 'var(--panel-border)',
            position: 'relative',
            transition: 'background 120ms',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: on ? 16 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--panel-bg)',
              transition: 'left 120ms',
            }}
          />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: on ? 700 : 500, color: on ? 'var(--gold-light)' : 'var(--text)' }}>
            {on ? 'オン' : 'オフ'}
          </span>
          <span style={{ marginLeft: 8, fontSize: 12.5, color: 'var(--text-dim)' }}>{target.label}</span>
        </span>
      </button>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)' }}>
        オンにすると出題をこのシナリオへ固定し、通しモードになります。ターン以降が事前計算済みで待ち時間がありません。
      </div>
    </div>
  )
}

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

      <FocusModeToggle />

      <div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
          出題シナリオ{availability === null && '(解データを確認中...)'}
          {settings.focusScenarioId && <span style={{ marginLeft: 8 }}>（特化モード中のため変更できません）</span>}
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
                  const disabled = !badge.playable || settings.focusScenarioId !== null
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
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => setScenarioEnabled(s.id, e.target.checked)} />
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
