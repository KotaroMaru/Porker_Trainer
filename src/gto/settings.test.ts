// P6 Step B7: settings.tsのテスト。このテスト環境のglobalThis.localStorageは
// (jsdom設定下でも)メソッド呼び出しが例外を投げる制約があるため
// (Node組み込みlocalStorageスタブが--localstorage-file未指定で機能しないことが原因、
// 実測で確認済み)、store.test.tsのfetchスタブと同じ要領でMapベースの簡易実装に
// 差し替えて往復を検証する。settings.ts自体のtry-catchが本番のlocalStorage不可時
// (プライベートブラウジング等)にdefaultGtoSettingsへ安全にフォールバックすることは、
// 「壊れたJSON」テストで間接的に担保する(localStorage自体が使えない場合とパース
// 失敗の場合は、どちらも同じcatchブロックを通るため等価)。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defaultGtoSettings, saveGtoSettings, loadGtoSettings } from './settings'
import { SCENARIOS } from './data/scenarios'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe('GtoSettings (localStorage永続化)', () => {
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
  })

  it('未保存時はdefaultGtoSettings(単発モード・全シナリオ有効)を返す', () => {
    const loaded = loadGtoSettings()
    expect(loaded).toEqual(defaultGtoSettings())
    expect(loaded.mode).toBe('single')
    expect(loaded.enabledScenarioIds.length).toBe(SCENARIOS.length)
  })

  it('save→loadで往復する', () => {
    const settings = { mode: 'full' as const, enabledScenarioIds: ['srp_btn_vs_bb', 'srp_co_vs_bb'] }
    saveGtoSettings(settings)
    expect(loadGtoSettings()).toEqual(settings)
  })

  it('壊れたJSONが保存されている場合、またはlocalStorage自体が使えない場合はdefaultGtoSettingsにフォールバックする', () => {
    localStorage.setItem('poker_trainer_gto_settings', '{not valid json')
    expect(loadGtoSettings()).toEqual(defaultGtoSettings())

    // localStorageが例外を投げる環境(プライベートブラウジング等)を模擬する。
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
      },
      configurable: true,
    })
    expect(loadGtoSettings()).toEqual(defaultGtoSettings())
    expect(() => saveGtoSettings(defaultGtoSettings())).not.toThrow()
  })

  it('modeが不正な値の場合はdefaultGtoSettingsにフォールバックする', () => {
    localStorage.setItem('poker_trainer_gto_settings', JSON.stringify({ mode: 'triple', enabledScenarioIds: [] }))
    expect(loadGtoSettings()).toEqual(defaultGtoSettings())
  })

  it('enabledScenarioIdsが配列でない場合はdefaultGtoSettingsにフォールバックする', () => {
    localStorage.setItem('poker_trainer_gto_settings', JSON.stringify({ mode: 'single', enabledScenarioIds: 'not-an-array' }))
    expect(loadGtoSettings()).toEqual(defaultGtoSettings())
  })
})
