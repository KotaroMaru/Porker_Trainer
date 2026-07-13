#!/usr/bin/env node
// P8-4: GitHub Actionsバッチ生成ワークフローのcollectジョブ用マージスクリプト。
// solveジョブ(matrix、chunkごとに1並列ジョブ)がartifactとしてアップロードした
// public/gto/solutions/<scenarioId>/*.bin + manifest.json の断片を全て集約し、
// リポジトリ本体(collectジョブがcheckoutしたワーキングツリー)へ書き込む。
// 失敗したチャンクがあってもartifactが存在する分だけ取り込む(成功分のみコミット)。
//
// 使い方: node ci-merge.mjs <scenarioId> <artifactsDir>
//   <artifactsDir>: actions/download-artifactの出力先(各チャンクのartifactが
//     サブディレクトリとして並ぶ。各サブディレクトリ内に
//     public/gto/solutions/<scenarioId>/*.bin と manifest.json が入っている想定)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const [scenarioId, artifactsDirArg] = process.argv.slice(2)
if (!scenarioId || !artifactsDirArg) {
  console.error('usage: node ci-merge.mjs <scenarioId> <artifactsDir>')
  process.exit(1)
}

const outDir = join(repoRoot, 'public/gto/solutions', scenarioId)
mkdirSync(outDir, { recursive: true })

const manifestPath = join(outDir, 'manifest.json')
/** @type {Map<string, {flop:string, expl_pot_frac:number, seconds:number, bytes:number}>} */
const merged = new Map()
if (existsSync(manifestPath)) {
  for (const entry of JSON.parse(readFileSync(manifestPath, 'utf8'))) merged.set(entry.flop, entry)
}

let binCount = 0
let manifestCount = 0

if (existsSync(artifactsDirArg)) {
  for (const chunkDirName of readdirSync(artifactsDirArg)) {
    const chunkDir = join(artifactsDirArg, chunkDirName)
    if (!statSync(chunkDir).isDirectory()) continue
    const chunkSolutionsDir = join(chunkDir, 'public/gto/solutions', scenarioId)
    if (!existsSync(chunkSolutionsDir)) continue

    for (const file of readdirSync(chunkSolutionsDir)) {
      if (file.endsWith('.bin')) {
        copyFileSync(join(chunkSolutionsDir, file), join(outDir, file))
        binCount++
      }
    }

    const chunkManifestPath = join(chunkSolutionsDir, 'manifest.json')
    if (existsSync(chunkManifestPath)) {
      for (const entry of JSON.parse(readFileSync(chunkManifestPath, 'utf8'))) {
        merged.set(entry.flop, entry)
        manifestCount++
      }
    }
  }
}

const mergedList = [...merged.values()].sort((a, b) => a.flop.localeCompare(b.flop))
writeFileSync(manifestPath, JSON.stringify(mergedList, null, 2))

console.log(`merged ${binCount} .bin files and ${manifestCount} manifest entries from artifacts`)
console.log(`scenario ${scenarioId}: ${mergedList.length} flops now generated (manifest.json total)`)
