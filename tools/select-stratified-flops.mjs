#!/usr/bin/env node
// 全同型フロップから、生成済み解を必ず残しつつテクスチャ層化した部分集合を選ぶ。
//
// 実行: node tools/select-stratified-flops.mjs [件数]
// 入力: src/gto/data/flopsAll.json
//       public/gto/solutions/srp_btn_vs_bb/*.bin (必須フロップ)
// 出力: src/gto/data/flops.json
//       tools/solver/scenarios/srp_btn_vs_bb.json の flops のみ

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(scriptDirectory, '..')
const allFlopsPath = join(projectRoot, 'src/gto/data/flopsAll.json')
const selectedFlopsPath = join(projectRoot, 'src/gto/data/flops.json')
const scenarioPath = join(projectRoot, 'tools/solver/scenarios/srp_btn_vs_bb.json')
const solutionDirectory = join(projectRoot, 'public/gto/solutions/srp_btn_vs_bb')

const STRATA = [
  'monotone-unpaired',
  'monotone-paired',
  'twoTone-unpaired',
  'twoTone-paired',
  'rainbow-unpaired',
  'rainbow-paired',
]

function stratumOf(flop) {
  const suitTexture = flop.texture.monotone ? 'monotone' : flop.texture.twoTone ? 'twoTone' : 'rainbow'
  return `${suitTexture}-${flop.texture.paired ? 'paired' : 'unpaired'}`
}

function cardString(flop) {
  return flop.cards.join('')
}

/**
 * 生成済みフロップを初期値に、母集団の真の出現確率から最も外れない層を1件ずつ補う。
 * 層内はflopsAll.jsonの順序を使い、同点はSTRATA順なので選択は決定的になる。
 */
export function selectStratifiedFlops(allFlops, requiredCardStrings, count) {
  if (!Number.isInteger(count) || count <= 0 || count > allFlops.length) {
    throw new RangeError(`件数は1〜${allFlops.length}の整数である必要があります`)
  }

  const required = new Set(requiredCardStrings)
  const allByCards = new Map(allFlops.map((flop) => [cardString(flop), flop]))
  for (const cards of required) {
    if (!allByCards.has(cards)) throw new Error(`生成済みフロップがflopsAll.jsonにありません: ${cards}`)
  }
  if (required.size > count) {
    throw new RangeError(`指定件数${count}は生成済みフロップ${required.size}件より少なくできません`)
  }

  const populationWeight = allFlops.reduce((sum, flop) => sum + flop.weight, 0)
  const targetShare = new Map(
    STRATA.map((stratum) => [
      stratum,
      allFlops.filter((flop) => stratumOf(flop) === stratum).reduce((sum, flop) => sum + flop.weight, 0) /
        populationWeight,
    ]),
  )
  const groups = new Map(
    STRATA.map((stratum) => [
      stratum,
      allFlops.filter((flop) => !required.has(cardString(flop)) && stratumOf(flop) === stratum),
    ]),
  )
  const used = new Map(STRATA.map((stratum) => [stratum, 0]))
  const selected = allFlops.filter((flop) => required.has(cardString(flop)))
  const selectedByStratum = new Map(
    STRATA.map((stratum) => [
      stratum,
      selected.filter((flop) => stratumOf(flop) === stratum).reduce((sum, flop) => sum + flop.weight, 0),
    ]),
  )
  let selectedWeight = selected.reduce((sum, flop) => sum + flop.weight, 0)

  while (selected.length < count) {
    let bestStratum
    let bestScore = Infinity

    for (const stratum of STRATA) {
      const candidate = groups.get(stratum)?.[used.get(stratum) ?? 0]
      if (!candidate) continue
      const nextTotal = selectedWeight + candidate.weight
      let score = 0
      for (const measuredStratum of STRATA) {
        const nextWeight =
          (selectedByStratum.get(measuredStratum) ?? 0) +
          (measuredStratum === stratum ? candidate.weight : 0)
        score += (nextWeight / nextTotal - (targetShare.get(measuredStratum) ?? 0)) ** 2
      }
      if (score < bestScore) {
        bestStratum = stratum
        bestScore = score
      }
    }

    if (bestStratum === undefined) throw new Error('層化選択中に候補がなくなりました')
    const candidateIndex = used.get(bestStratum) ?? 0
    const candidate = groups.get(bestStratum)?.[candidateIndex]
    if (!candidate) throw new Error(`層${bestStratum}からフロップを取得できませんでした`)
    selected.push(candidate)
    selectedWeight += candidate.weight
    selectedByStratum.set(bestStratum, (selectedByStratum.get(bestStratum) ?? 0) + candidate.weight)
    used.set(bestStratum, candidateIndex + 1)
  }

  return selected
}

export function scenarioWithFlops(scenario, flops) {
  return { ...scenario, flops: flops.map(cardString) }
}

function main() {
  const countArgument = process.argv[2] ?? '300'
  const count = Number(countArgument)
  const allFlops = JSON.parse(readFileSync(allFlopsPath, 'utf8'))
  const requiredCardStrings = readdirSync(solutionDirectory)
    .filter((name) => name.endsWith('.bin'))
    .map((name) => name.slice(0, -'.bin'.length))
  const selected = selectStratifiedFlops(allFlops, requiredCardStrings, count)
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))

  writeFileSync(selectedFlopsPath, `${JSON.stringify(selected, null, 2)}\n`)
  writeFileSync(scenarioPath, `${JSON.stringify(scenarioWithFlops(scenario, selected), null, 2)}\n`)
  console.log(`生成完了: ${selected.length}件 → ${selectedFlopsPath}, ${scenarioPath}`)
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
