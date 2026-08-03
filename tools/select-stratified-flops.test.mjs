import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scenarioWithFlops, selectStratifiedFlops } from './select-stratified-flops.mjs'

const toolDirectory = dirname(fileURLToPath(import.meta.url))
const root = join(toolDirectory, '..')
const allFlops = JSON.parse(readFileSync(join(root, 'src/gto/data/flopsAll.json'), 'utf8'))
const requiredCardStrings = readdirSync(join(root, 'public/gto/solutions/srp_btn_vs_bb'))
  .filter((name) => name.endsWith('.bin'))
  .map((name) => name.slice(0, -'.bin'.length))

describe('select-stratified-flops.mjs', () => {
  it('生成済み解を保持した決定的な300件を選ぶ', () => {
    const first = selectStratifiedFlops(allFlops, requiredCardStrings, 300)
    const second = selectStratifiedFlops(allFlops, [...requiredCardStrings].reverse(), 300)
    const selectedCards = new Set(first.map((flop) => flop.cards.join('')))

    expect(first).toHaveLength(300)
    expect(second).toEqual(first)
    expect(selectedCards.size).toBe(300)
    for (const cards of requiredCardStrings) expect(selectedCards.has(cards), cards).toBe(true)
  })

  it('件数を変更でき、シナリオのflops以外を維持する', () => {
    const selected = selectStratifiedFlops(allFlops, requiredCardStrings, 500)
    const scenario = { scenarioId: 'example', label: '保持される', flops: ['old'] }

    expect(selected).toHaveLength(500)
    expect(scenarioWithFlops(scenario, selected)).toEqual({
      scenarioId: 'example',
      label: '保持される',
      flops: selected.map((flop) => flop.cards.join('')),
    })
  })

  it('生成済み解を落とす件数や範囲外の件数を拒否する', () => {
    expect(() => selectStratifiedFlops(allFlops, requiredCardStrings, requiredCardStrings.length - 1)).toThrow(
      RangeError,
    )
    expect(() => selectStratifiedFlops(allFlops, requiredCardStrings, allFlops.length + 1)).toThrow(RangeError)
  })
})
