import { solveCfr } from '../solver/cfr'
import type { CfrGame, DecisionNode } from '../solver/cfr'
import { extractDecisionEvs } from '../solver/nodeEvs'
import { scoreComboOnBoard } from '../solver/handEval'
import { buildTurnSubgameTree, buildStreetTree } from '../tree/actionTree'
import { buildNodeIndex, nodeDataAt } from './solutionRepo'
import type { Combo } from '../../analysis/range'
import type { Card } from '../../engine/types'
import type { DecodedNode } from '../loader/binaryFormat'
import type { WorkerRequest, WorkerResponse, SolveResultSummary } from './protocol'

// Vite: `new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' })`
// で読み込まれるWeb Workerのエントリポイント。
//
// P6 Step B3(プロトコルv2): 全決断ノードの戦略を丸ごとシリアライズしていた旧実装
// (潜在的性能バグ)を廃止し、Workerが最新1ソルブの解(索引+平均戦略+EV)を
// 保持して、UIがgetNodesで必要なノードだけを個別取得する「収穫」パターン
// (D2)に置き換えた。1 Worker内で保持するソルブは常に1つ(次のsolveStreetで
// 前のcurrentSolveは自然に上書きされる。呼び出し側は上書き前に必要なノードを
// 収穫し終えている前提)。

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

function cardKeyLocal(c: Card): string {
  return `${c.rank}${c.suit}`
}

let currentCancelled = false
let solveCounter = 0
let currentSolve: {
  solveId: string
  index: Map<string, DecisionNode>
  getStrategy: (node: DecisionNode) => { actionLabels: string[]; frequencies: number[][] }
  evs: Map<DecisionNode, Float32Array>
} | null = null

function handleGetNodes(req: Extract<WorkerRequest, { kind: 'getNodes' }>): void {
  const { requestId } = req
  try {
    if (!currentSolve || currentSolve.solveId !== req.solveId) {
      throw new Error(`getNodes: no active solve matches solveId "${req.solveId}" (stale request? Workerは最新1ソルブしか保持しない)`)
    }
    const nodes: Record<string, DecodedNode | null> = {}
    for (const nodeId of req.nodeIds) {
      nodes[nodeId] = nodeDataAt(currentSolve.index, currentSolve.getStrategy, currentSolve.evs, nodeId)
    }
    const msg: WorkerResponse = { kind: 'nodes', requestId, nodes }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = { kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  }
}

function handleSolveStreet(req: Extract<WorkerRequest, { kind: 'solveStreet' }>): void {
  currentCancelled = false
  const { requestId } = req
  const startTime = performance.now()

  try {
    const boardKeys = req.board.map(cardKeyLocal)
    const tree =
      req.street === 'turn'
        ? buildTurnSubgameTree({
            turnPotBb: req.potBb,
            effectiveStackBb: req.effectiveStackBb,
            firstToAct: req.firstToAct,
            deadCards: req.board,
          })
        : buildStreetTree({
            potBb: req.potBb,
            effectiveStackBb: req.effectiveStackBb,
            firstToAct: req.firstToAct,
          })

    const game: CfrGame<Combo> = {
      root: tree,
      players: [
        { hands: req.oopCombos, initialReach: req.oopReach, cards: comboCards },
        { hands: req.ipCombos, initialReach: req.ipReach, cards: comboCards },
      ],
      // ターンはchanceノード経由でterminal.boardが刻印されるのでscoreComboOnBoardを
      // そのまま渡す。リバーはbuildStreetTree単体(chanceノード無し)でboardが
      // 刻印されないため、5枚ボードをクロージャで閉じ込める(riverToy等と同じ設計)。
      score: req.street === 'turn' ? scoreComboOnBoard : (combo: Combo) => scoreComboOnBoard(combo, boardKeys),
    }

    const solution = solveCfr(game, {
      maxIterations: req.maxIterations ?? 500,
      targetExploitability: req.targetExploitability ?? 0.005,
      checkEveryIterations: 50,
      onProgress: (iterationsRun, exploitability) => {
        const msg: WorkerResponse = { kind: 'progress', requestId, iterationsRun, exploitability }
        self.postMessage(msg)
      },
      shouldCancel: () => currentCancelled,
    })

    const getAvgStrategy = (node: DecisionNode) => solution.getStrategy(node).frequencies
    const evs = extractDecisionEvs(game, getAvgStrategy)
    const index = buildNodeIndex(tree)

    solveCounter += 1
    const solveId = `solve${solveCounter}`
    currentSolve = { solveId, index, getStrategy: solution.getStrategy, evs }

    const resultSummary: SolveResultSummary = {
      solveId,
      iterationsRun: solution.iterationsRun,
      exploitability: solution.exploitability,
      gameValue: solution.gameValue,
    }
    const msg: WorkerResponse = { kind: 'result', requestId, solution: resultSummary, elapsedMs: performance.now() - startTime }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = { kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.kind === 'cancel') {
    currentCancelled = true
    return
  }
  if (req.kind === 'getNodes') {
    handleGetNodes(req)
    return
  }
  handleSolveStreet(req)
}
