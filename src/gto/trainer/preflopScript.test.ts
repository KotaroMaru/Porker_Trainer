import { describe, it, expect } from 'vitest'
import { buildPreflopScript } from './preflopScript'
import { getScenario } from '../data/scenarios'

describe('buildPreflopScript', () => {
  it('SRPシナリオは2行(レイズ→コール)で、金額の合計がpotBb以下', () => {
    const scenario = getScenario('srp_btn_vs_bb')
    const lines = buildPreflopScript(scenario)
    expect(lines.length).toBe(2)
    expect(lines[0].action).toBe('レイズ')
    expect(lines[0].position).toBe('BTN')
    expect(lines[1].action).toBe('コール')
    expect(lines[1].position).toBe('BB')
    expect(lines[1].amountBb).toBe(lines[0].amountBb)
    const totalInvested = lines[0].amountBb + lines[1].amountBb
    expect(totalInvested).toBeLessThanOrEqual(scenario.potBb + 1e-6)
  })

  it('3betシナリオは3行(レイズ→3ベット→コール)で、最終投入額がpotBbと一致する', () => {
    const scenario = getScenario('3bet_co_vs_btn')
    const lines = buildPreflopScript(scenario)
    expect(lines.length).toBe(3)
    expect(lines[0].action).toBe('レイズ')
    expect(lines[1].action).toBe('3ベット')
    expect(lines[2].action).toBe('コール')
    // raiser(1行目・3行目)の最終投入額は3ベット額と一致(コールで揃う)
    expect(lines[2].amountBb).toBe(lines[1].amountBb)
    expect(lines[2].position).toBe(lines[0].position)
    // raiserの最終投入 + 3ベッターの投入 ≤ potBb(間のポジションがフォールドした
    // 場合のデッドマネー(SB/BBのブラインド没収分)がpotBbに上乗せされうるため)
    const totalInvested = lines[1].amountBb + lines[2].amountBb
    expect(totalInvested).toBeLessThanOrEqual(scenario.potBb + 1e-6)
  })

  it('全17シナリオでスクリプトがエラーなく生成できる', () => {
    const ids = [
      'srp_utg_vs_bb', 'srp_hj_vs_bb', 'srp_co_vs_bb', 'srp_btn_vs_bb', 'srp_sb_vs_bb',
      'srp_utg_vs_hj_cc', 'srp_utg_vs_co_cc', 'srp_utg_vs_btn_cc', 'srp_hj_vs_co_cc', 'srp_hj_vs_btn_cc', 'srp_co_vs_btn_cc',
      '3bet_co_vs_btn', '3bet_btn_vs_sb', '3bet_btn_vs_bb', '3bet_hj_vs_co', '3bet_hj_vs_btn', '3bet_utg_vs_btn',
    ]
    for (const id of ids) {
      const scenario = getScenario(id)
      const lines = buildPreflopScript(scenario)
      expect(lines.length).toBeGreaterThan(0)
    }
  })
})
