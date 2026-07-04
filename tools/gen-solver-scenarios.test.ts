import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tools/gen-solver-scenarios.mjs が生成する tools/solver/scenarios/*.json の
// 構造検証(P3 Step 2)。実際にスクリプトを実行してから出力を検証する
// (ソース側であるsrc/gto/data/scenarios.tsの変更に追従できているかも兼ねて確認)。

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCENARIOS_DIR = join(ROOT, 'tools/solver/scenarios')

interface ScenarioFile {
  scenarioId: string
  label: string
  oopPosition: string
  ipPosition: string
  oopRangeStr: string
  ipRangeStr: string
  startingPotChips: number
  effectiveStackChips: number
  flops: string[]
}

const POSTFLOP_ORDER = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']

describe('gen-solver-scenarios.mjs', () => {
  let files: ScenarioFile[]

  beforeAll(() => {
    execFileSync('node', [join(ROOT, 'tools/gen-solver-scenarios.mjs')], { stdio: 'pipe' })
    const names = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.json'))
    files = names.map((f) => JSON.parse(readFileSync(join(SCENARIOS_DIR, f), 'utf8')))
  })

  it('17シナリオ全てが生成される', () => {
    expect(files.length).toBe(17)
  })

  it('OOPポジションがIPポジションよりポストフロップ行動順で先になっている', () => {
    for (const f of files) {
      const oopIdx = POSTFLOP_ORDER.indexOf(f.oopPosition)
      const ipIdx = POSTFLOP_ORDER.indexOf(f.ipPosition)
      expect(oopIdx).toBeGreaterThanOrEqual(0)
      expect(ipIdx).toBeGreaterThanOrEqual(0)
      expect(oopIdx).toBeLessThan(ipIdx)
    }
  })

  it('チップ額(0.1bb単位)は整数で、実効スタックはポットより十分大きい', () => {
    for (const f of files) {
      expect(Number.isInteger(f.startingPotChips)).toBe(true)
      expect(Number.isInteger(f.effectiveStackChips)).toBe(true)
      expect(f.startingPotChips).toBeGreaterThan(0)
      expect(f.effectiveStackChips).toBeGreaterThan(f.startingPotChips)
    }
  })

  it('レンジ文字列が空でなく、PioSOLVER形式のトークンのみで構成される', () => {
    const tokenPattern = /^[2-9TJQKA]{2}[so]?(:[0-9.]+)?$/
    for (const f of files) {
      for (const rangeStr of [f.oopRangeStr, f.ipRangeStr]) {
        expect(rangeStr.length).toBeGreaterThan(0)
        const tokens = rangeStr.split(',')
        expect(tokens.length).toBeGreaterThan(0)
        for (const token of tokens) {
          expect(token).toMatch(tokenPattern)
        }
      }
    }
  })

  it('各シナリオが95個の代表フロップを持ち、各フロップが3枚のカード文字列(rank+suit)である', () => {
    const flopPattern = /^([2-9TJQKA][cdhs]){3}$/
    for (const f of files) {
      expect(f.flops.length).toBe(95)
      for (const flop of f.flops) {
        expect(flop).toMatch(flopPattern)
      }
    }
  })

  it('scenarioIdがファイル名と一致する', () => {
    for (const f of files) {
      expect(typeof f.scenarioId).toBe('string')
      expect(f.scenarioId.length).toBeGreaterThan(0)
    }
  })
})
