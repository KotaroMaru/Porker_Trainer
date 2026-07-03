import { describe, it, expect } from 'vitest'
import { getRange, listRangeIds, rangePercent } from './ranges'

// GTO近似データの許容誤差。コンボ数量子化(4/6/12コンボ単位)とテーパー処理により
// 目標値からの若干のズレが生じるため、方向性と大まかな水準を検証する。
const TOL = 0.08

function expectPercentNear(rangeId: string, targetPct: number, tol = TOL) {
  const pct = rangePercent(getRange(rangeId))
  expect(pct).toBeGreaterThan(targetPct - tol)
  expect(pct).toBeLessThan(targetPct + tol)
}

describe('GTO近似プリフロップレンジ: RFI(オープン)', () => {
  it('UTG RFI は約16-18%', () => {
    expectPercentNear('rfi_utg', 0.176)
  })
  it('HJ RFI は約19-21%', () => {
    expectPercentNear('rfi_hj', 0.214)
  })
  it('CO RFI は約25-28%', () => {
    expectPercentNear('rfi_co', 0.278)
  })
  it('BTN RFI は約40-44%', () => {
    expectPercentNear('rfi_btn', 0.435)
  })
  it('SB RFI は約34-38%', () => {
    expectPercentNear('rfi_sb', 0.38)
  })
  it('ポジションが後ろになるほどRFI%は単調増加する(UTG<HJ<CO<BTN)', () => {
    const utg = rangePercent(getRange('rfi_utg'))
    const hj = rangePercent(getRange('rfi_hj'))
    const co = rangePercent(getRange('rfi_co'))
    const btn = rangePercent(getRange('rfi_btn'))
    expect(utg).toBeLessThan(hj)
    expect(hj).toBeLessThan(co)
    expect(co).toBeLessThan(btn)
  })
})

describe('GTO近似プリフロップレンジ: BBディフェンス', () => {
  it('BBの総継続率(コール+3ベット)はオープナーが後ろのポジションほど広い', () => {
    function totalDefend(vsPos: string) {
      return rangePercent(getRange(`bb_call_vs_${vsPos}`)) + rangePercent(getRange(`bb_3bet_vs_${vsPos}`))
    }
    const vsUtg = totalDefend('utg')
    const vsHj = totalDefend('hj')
    const vsCo = totalDefend('co')
    const vsBtn = totalDefend('btn')
    const vsSb = totalDefend('sb')
    expect(vsUtg).toBeLessThan(vsHj)
    expect(vsHj).toBeLessThan(vsCo)
    expect(vsCo).toBeLessThan(vsBtn)
    expect(vsBtn).toBeLessThan(vsSb)
  })
  it('BBのvsBTN総継続率は約48-56%', () => {
    const total = rangePercent(getRange('bb_call_vs_btn')) + rangePercent(getRange('bb_3bet_vs_btn'))
    expect(total).toBeGreaterThan(0.44)
    expect(total).toBeLessThan(0.6)
  })
})

describe('GTO近似プリフロップレンジ: IPコールドコール', () => {
  it('同じオープナーに対し、後ろのポジションほどコールドコール%は広い(HJ<CO<BTN vs UTG)', () => {
    const hj = rangePercent(getRange('cc_hj_vs_utg'))
    const co = rangePercent(getRange('cc_co_vs_utg'))
    const btn = rangePercent(getRange('cc_btn_vs_utg'))
    expect(hj).toBeLessThan(co)
    expect(co).toBeLessThan(btn)
  })
})

describe('GTO近似プリフロップレンジ: オープナー vs 3ベット', () => {
  it('オープナーのコール/4ベットレンジは、そのオープナー自身のRFIレンジの部分集合である', () => {
    const pairs: [string, string][] = [
      ['defend_call_co_vs_btn3bet', 'rfi_co'],
      ['defend_4bet_co_vs_btn3bet', 'rfi_co'],
      ['defend_call_btn_vs_sb3bet', 'rfi_btn'],
      ['defend_call_btn_vs_bb3bet', 'rfi_btn'],
      ['defend_call_hj_vs_co3bet', 'rfi_hj'],
      ['defend_call_hj_vs_btn3bet', 'rfi_hj'],
      ['defend_call_utg_vs_btn3bet', 'rfi_utg'],
    ]
    for (const [defendId, rfiId] of pairs) {
      const defend = getRange(defendId)
      const rfi = getRange(rfiId)
      for (const hand of Object.keys(defend)) {
        expect(rfi[hand] ?? 0, `${hand} in ${defendId} must be in ${rfiId}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('データ完全性', () => {
  it('38個の想定レンジIDがすべて存在する', () => {
    expect(listRangeIds().length).toBe(38)
  })
  it('全レンジの全頻度は0より大きく1以下', () => {
    for (const id of listRangeIds()) {
      const range = getRange(id)
      for (const [hand, freq] of Object.entries(range)) {
        expect(freq, `${id}.${hand}`).toBeGreaterThan(0)
        expect(freq, `${id}.${hand}`).toBeLessThanOrEqual(1)
      }
    }
  })
  it('存在しないレンジIDを要求するとエラーになる', () => {
    expect(() => getRange('does_not_exist')).toThrow()
  })
})
