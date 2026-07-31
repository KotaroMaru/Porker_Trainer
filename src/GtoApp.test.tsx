/// <reference types="node" />
// P12 Phase A-3: 新GTOアプリシェル(GtoApp)のトップタブ⇄サブタブ切替の結合テスト。
// PlayScreenが初期表示で startNewSpot() → loadAvailability() 経由でfetchを呼びうるため、
// GtoTrainerView.test.tsxと同じパターンで404スタブ+メモリlocalStorageを用意する。

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GtoApp } from './GtoApp'
import { useGtoStore, initialTally } from './gto/store'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  } as Storage
}

describe('GtoApp (P12 Phase A-3)', () => {
  const originalFetch = globalThis.fetch
  const originalLocalStorage = globalThis.localStorage

  beforeAll(() => {
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch
    // jsdomはwindow.matchMediaを実装していない(useIsMobileが依存する)。
    // デスクトップ幅を常に返す最小限のスタブで、GtoApp自体はデスクトップレイアウトで検証する。
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
    useGtoStore.setState({
      status: 'idle',
      spot: null,
      grading: null,
      chosenLabel: null,
      errorMessage: null,
      sessionTally: initialTally(),
      activeTab: 'play',
      review: null,
      reviewSource: 'live',
      reviewFeatures: [],
      reviewFeaturesStatus: 'idle',
      activeDecisionIdx: 0,
      fullHand: null,
      fullHandController: null,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('5つのトップタブが表示され、初期状態はプレイタブ(サブタブ無し)', () => {
    render(<GtoApp />)
    expect(screen.getByText('プレイ')).toBeInTheDocument()
    expect(screen.getByText('デイリー')).toBeInTheDocument()
    expect(screen.getByText('解析')).toBeInTheDocument()
    expect(screen.getByText('学習')).toBeInTheDocument()
    expect(screen.getByText('設定')).toBeInTheDocument()
    // サブタブ行(カスタム解析等)はプレイタブでは出ない
    expect(screen.queryByText('カスタム解析')).not.toBeInTheDocument()
  })

  it('「解析」タブをクリックするとサブタブ(カスタム解析/保存済み/ズレ分析)が表示され、既定でカスタム解析が開く', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('解析'))
    expect(useGtoStore.getState().activeTab).toBe('review')
    expect(screen.getByText('カスタム解析')).toBeInTheDocument()
    expect(screen.getByText('保存済み')).toBeInTheDocument()
    expect(screen.getByText('ズレ分析')).toBeInTheDocument()
    expect(screen.getByText('カスタムハンド解析')).toBeInTheDocument()
  })

  it('「解析」グループ内でサブタブを「保存済み」へ切り替えられ、空状態メッセージが出る', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('解析'))
    fireEvent.click(screen.getByText('保存済み'))
    expect(useGtoStore.getState().activeTab).toBe('bookmarks')
    expect(screen.getByText(/保存済みのハンドはまだありません/)).toBeInTheDocument()
  })

  it('サブタブを選んだ状態で同じトップタブを再クリックしても、サブタブの選択は既定へ戻らない(回帰防止)', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('解析'))
    fireEvent.click(screen.getByText('保存済み'))
    expect(useGtoStore.getState().activeTab).toBe('bookmarks')
    fireEvent.click(screen.getByText('解析')) // 既に解析グループ内なので何もしない
    expect(useGtoStore.getState().activeTab).toBe('bookmarks')
  })

  it('「学習」タブをクリックするとサブタブ(レンジ表/色当てクイズ)が表示され、既定でレンジ表が開く', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('学習'))
    expect(useGtoStore.getState().activeTab).toBe('range')
    expect(screen.getByText('ヨコサワレンジ表')).toBeInTheDocument()
    expect(screen.getByText('色当てクイズ')).toBeInTheDocument()
  })

  it('「学習」グループ内で「色当てクイズ」サブタブへ切り替えられる', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('学習'))
    fireEvent.click(screen.getByText('色当てクイズ'))
    expect(useGtoStore.getState().activeTab).toBe('tierquiz')
    expect(screen.getByText('この手はヨコサワモデルで何色？')).toBeInTheDocument()
  })

  it('「設定」タブをクリックするとモード切替(単発/通し)が表示される', () => {
    render(<GtoApp />)
    fireEvent.click(screen.getByText('設定'))
    expect(useGtoStore.getState().activeTab).toBe('settings')
    expect(screen.getByText('単発')).toBeInTheDocument()
    expect(screen.getByText('通し')).toBeInTheDocument()
  })

  it('「デイリー」タブをクリックするとデイリー開始画面が表示される', () => {
    useGtoStore.setState({ dailyChallenge: null, dailyRank: 1000 })
    render(<GtoApp />)
    fireEvent.click(screen.getByText('デイリー'))
    expect(useGtoStore.getState().activeTab).toBe('daily')
    expect(screen.getByText('本日のチャレンジ（10問）')).toBeInTheDocument()
  })
})
