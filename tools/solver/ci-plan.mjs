#!/usr/bin/env node
// P8-4: GitHub Actionsバッチ生成ワークフロー用のプランニングスクリプト。
// 指定シナリオの全フロップから、public/gto/solutions/<id>/manifest.json に
// 記載済み(=解生成済み)のフロップを除外し、chunkSize件ずつに分割した
// GitHub Actions matrix定義(JSON)を標準出力へ書き出す。
//
// 使い方: node ci-plan.mjs <scenarioId> <chunkSize> [limit]
//   <scenarioId>: tools/solver/scenarios/<scenarioId>.json のID
//   <chunkSize>: 1チャンク(=1並列ジョブ)あたりのフロップ数
//   [limit]: 省略可。指定時は残りフロップの先頭N件のみを対象にする(試走用)
//
// 出力(標準出力、1行JSON): { "matrix": {"include":[{"flops":[...]}...]}, "hasWork": bool, "totalRemaining": number }

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const [scenarioId, chunkSizeArg, limitArg] = process.argv.slice(2)
if (!scenarioId) {
  console.error('usage: node ci-plan.mjs <scenarioId> <chunkSize> [limit]')
  process.exit(1)
}
const chunkSize = Math.max(1, Number.parseInt(chunkSizeArg ?? '1', 10) || 1)
const limit = limitArg ? Math.max(0, Number.parseInt(limitArg, 10) || 0) : null

const scenarioPath = join(repoRoot, 'tools/solver/scenarios', `${scenarioId}.json`)
if (!existsSync(scenarioPath)) {
  console.error(`scenario file not found: ${scenarioPath}`)
  process.exit(1)
}
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const allFlops = scenario.flops
if (!Array.isArray(allFlops)) {
  console.error(`scenario ${scenarioId} has no flops array`)
  process.exit(1)
}

const manifestPath = join(repoRoot, 'public/gto/solutions', scenarioId, 'manifest.json')
const doneFlops = new Set()
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const entry of manifest) doneFlops.add(entry.flop)
}

let remaining = allFlops.filter((f) => !doneFlops.has(f))
if (limit !== null) remaining = remaining.slice(0, limit)

const chunks = []
for (let i = 0; i < remaining.length; i += chunkSize) {
  chunks.push({ flops: remaining.slice(i, i + chunkSize) })
}

const result = {
  matrix: { include: chunks },
  hasWork: chunks.length > 0,
  totalRemaining: remaining.length,
  totalFlops: allFlops.length,
  alreadyDone: doneFlops.size,
}

process.stdout.write(JSON.stringify(result))
