import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AnalyzerScreen } from './AnalyzerScreen'
import { initialTally, useGtoStore } from '../../gto/store'

describe('AnalyzerScreen', () => {
  beforeEach(() => {
    useGtoStore.setState({ activeTab: 'review', review: null, reviewSource: 'live', availability: new Map(), customAnalyzer: null, sessionTally: initialTally() })
  })

  it('シナリオ選択後にフロップ選択と無効な解析ボタンを表示する', async () => {
    render(<AnalyzerScreen />)
    await screen.findByText('カスタムハンド解析')
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'srp_btn_vs_bb' } })
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '解析する' })).toBeDisabled()
  })
})
