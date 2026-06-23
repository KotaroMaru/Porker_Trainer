import type { HandRecord, SessionStats, JudgePanelSettings } from './state'

const STORAGE_KEY = 'poker_trainer_session'
const JUDGE_SETTINGS_KEY = 'poker_trainer_judge_settings'

export interface PersistedData {
  handHistory: HandRecord[]
  sessionStats: SessionStats
}

export function saveSession(data: PersistedData): void {
  try {
    const serialized = JSON.stringify({
      ...data,
      handHistory: data.handHistory.map(r => ({
        ...r,
        payout: [...r.payout.entries()],
      })),
    })
    localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // localStorage not available (e.g. in tests)
  }
}

export function loadSession(): PersistedData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return {
      ...data,
      handHistory: (data.handHistory ?? []).map((r: HandRecord & { payout: [string, number][] }) => ({
        ...r,
        payout: new Map(r.payout),
      })),
    }
  } catch {
    return null
  }
}

export function saveJudgePanelSettings(settings: JudgePanelSettings): void {
  try {
    localStorage.setItem(JUDGE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // localStorage not available (e.g. in tests)
  }
}

export function loadJudgePanelSettings(): JudgePanelSettings | null {
  try {
    const raw = localStorage.getItem(JUDGE_SETTINGS_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
