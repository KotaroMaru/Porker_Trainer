/// <reference types="node" />
// P6 Step B9: SettingsScreen.tsxのテスト。globalThis.fetchをスタブし、
// srp_btn_vs_bb(実manifest、95枚)は出題可能・他シナリオは404(未生成)として、
// バッジ表示・チェックボックスのdisabled状態・トグルのstore書き込みを検証する。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { SettingsScreen } from './SettingsScreen'
import { useGtoStore, initialTally, __resetAvailabilityInflightForTests } from '../../gto/store'
import { defaultGtoSettings } from '../../gto/settings'
import { SCENARIOS } from '../../gto/data/scenarios'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.endsWith('manifest.json')) throw new Error(`unexpected fetch url in test stub: ${url}`)
    if (url.includes('/srp_btn_vs_bb/')) {
      const filePath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/manifest.json')
      const buf = await readFile(filePath, 'utf8')
      return new Response(buf, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  __resetAvailabilityInflightForTests()
  useGtoStore.setState({
    status: 'idle',
    spot: null,
    grading: null,
    chosenLabel: null,
    errorMessage: null,
    sessionTally: initialTally(),
    settings: defaultGtoSettings(),
    availability: null,
    fullHand: null,
    fullHandController: null,
    review: null,
    reviewFeatures: [],
    reviewFeaturesStatus: 'idle',
    activeDecisionIdx: 0,
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('SettingsScreen', () => {
  it('モード切替ボタンをクリックするとstore.settings.modeが更新される', () => {
    render(<SettingsScreen />)
    expect(useGtoStore.getState().settings.mode).toBe('single')

    screen.getByText('通し').click()
    expect(useGtoStore.getState().settings.mode).toBe('full')

    screen.getByText('単発').click()
    expect(useGtoStore.getState().settings.mode).toBe('single')
  })

  it('生成済み(95/300)シナリオのチェックボックスは有効で、未生成シナリオは無効(チェック不可)になる', async () => {
    render(<SettingsScreen />)

    await waitFor(() => {
      // FLOPSは300件へ拡張済みだが解は95件。生成済み/対応予定 の比として表示される。
      expect(screen.getByText('95/300 生成中')).toBeInTheDocument()
    })
    expect(screen.getAllByText('未生成').length).toBe(SCENARIOS.length - 1)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const enabledCount = checkboxes.filter((c) => !c.disabled).length
    const disabledCount = checkboxes.filter((c) => c.disabled).length
    expect(enabledCount).toBe(1) // srp_btn_vs_bbのみ
    expect(disabledCount).toBe(SCENARIOS.length - 1)
  })

  it('生成済みシナリオのチェックボックスをオフにするとsetScenarioEnabledがstoreへ反映される', async () => {
    render(<SettingsScreen />)

    await waitFor(() => {
      // FLOPSは300件へ拡張済みだが解は95件。生成済み/対応予定 の比として表示される。
      expect(screen.getByText('95/300 生成中')).toBeInTheDocument()
    })
    expect(useGtoStore.getState().settings.enabledScenarioIds).toContain('srp_btn_vs_bb')

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const enabledCheckbox = checkboxes.find((c) => !c.disabled)
    if (!enabledCheckbox) throw new Error('expected exactly one enabled checkbox')
    enabledCheckbox.click()

    expect(useGtoStore.getState().settings.enabledScenarioIds).not.toContain('srp_btn_vs_bb')
  })

  it('特化モード中は理由を表示し、生成済みを含む全シナリオの変更を無効化する', async () => {
    useGtoStore.setState({ settings: { ...defaultGtoSettings(), mode: 'full', focusScenarioId: 'srp_btn_vs_bb' } })
    render(<SettingsScreen />)

    await waitFor(() => {
      // FLOPSは300件へ拡張済みだが解は95件。生成済み/対応予定 の比として表示される。
      expect(screen.getByText('95/300 生成中')).toBeInTheDocument()
    })
    expect(screen.getByText(/特化モード中のため変更できません/)).toBeInTheDocument()
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((checkbox) => checkbox.disabled)).toBe(true)
  })

  it('SRP vs BB / SRP: コールドコール / 3betポットの3グループが見出しとして表示される', () => {
    render(<SettingsScreen />)
    expect(screen.getByText('SRP: vs BB')).toBeInTheDocument()
    expect(screen.getByText('SRP: コールドコール')).toBeInTheDocument()
    expect(screen.getByText('3betポット')).toBeInTheDocument()
  })
})
