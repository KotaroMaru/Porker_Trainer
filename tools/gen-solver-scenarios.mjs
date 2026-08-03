#!/usr/bin/env node
// P3 Step 2: Rust事前計算パイプライン向けのシナリオJSONを生成する。
//
// 入力: src/gto/data/scenarios.ts (17マッチアップ定義)
//       src/gto/data/preflopRanges.json (頻度付きプリフロップレンジ、38件)
//       src/gto/data/flops.json (代表フロップ。件数は段階的に増える。P15段階B-1で95→300)
//
// 注意: このスクリプトはflops.jsonを全17シナリオへ一律に写す。対応フロップ数を増やすと
// 全シナリオのJSONが同じ件数になるが、実際にどこまで生成済みかはシナリオごとの
// manifest.jsonが持ち、アプリはavailability経由でそれに絞り込む(store.tsのselectFlopPool)。
// つまりJSONの件数は「生成対象の上限」であって「生成済み」ではない。
// バッチ生成(gto-batch.yml)はシナリオ単位の手動起動なので、ここが増えても
// 意図しない大量生成は起きない。
// 出力: tools/solver/scenarios/{scenarioId}.json (tools/solver/FORMAT.md セクション5準拠)
//
// OOP/IP判定: src/gto/data/scenarios.tsのisOopPosition(唯一の正典。trainer層と共有)。
//
// レンジ文字列: FreqRangeのキー("AKs","QQ","72o")は既にPioSOLVER互換のハンド記法
// なので、freq=1のハンドはそのまま、freq<1のハンドは"ハンド:頻度"を付与してカンマ連結する。
//
// 実行: node tools/gen-solver-scenarios.mjs

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'tools/solver/scenarios')

const { SCENARIOS, isOopPosition } = await import(join(ROOT, 'src/gto/data/scenarios.ts').replace(/\\/g, '/'))
const RANGES = JSON.parse(readFileSync(join(ROOT, 'src/gto/data/preflopRanges.json'), 'utf8'))
const FLOPS = JSON.parse(readFileSync(join(ROOT, 'src/gto/data/flops.json'), 'utf8'))

function rangeToPioString(rangeId) {
  const range = RANGES[rangeId]
  if (!range) throw new Error(`Unknown range id referenced by scenario: ${rangeId}`)
  const parts = []
  for (const [hand, freq] of Object.entries(range)) {
    if (freq <= 0) continue
    parts.push(freq >= 1 ? hand : `${hand}:${freq}`)
  }
  if (parts.length === 0) throw new Error(`Range ${rangeId} has no hands with freq > 0`)
  return parts.join(',')
}

function flopToRustString(flopDef) {
  return flopDef.cards.join('')
}

mkdirSync(OUT_DIR, { recursive: true })

const flopStrings = FLOPS.map(flopToRustString)

let written = 0
for (const scenario of SCENARIOS) {
  const { raiser, defender } = scenario
  const raiserIsOop = isOopPosition(raiser.position, defender.position)
  const oop = raiserIsOop ? raiser : defender
  const ip = raiserIsOop ? defender : raiser

  const out = {
    scenarioId: scenario.id,
    label: scenario.label,
    oopPosition: oop.position,
    ipPosition: ip.position,
    oopRangeStr: rangeToPioString(oop.rangeId),
    ipRangeStr: rangeToPioString(ip.rangeId),
    startingPotChips: Math.round(scenario.potBb * 10),
    effectiveStackChips: Math.round(scenario.effectiveStackBb * 10),
    flops: flopStrings,
  }

  writeFileSync(join(OUT_DIR, `${scenario.id}.json`), JSON.stringify(out, null, 2) + '\n')
  written++
}

console.log(`generated ${written} scenario JSON files -> ${OUT_DIR}`)
console.log(`each scenario carries ${flopStrings.length} flops`)
