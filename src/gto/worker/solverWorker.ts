import { solveCfr } from '../solver/cfr'
import type { CfrGame, DecisionNode, TreeNode } from '../solver/cfr'
import { scoreComboOnBoard } from '../solver/handEval'
import { buildTurnSubgameTree } from '../tree/actionTree'
import { rootNodeId, childNodeId } from '../tree/nodeId'
import type { Combo } from '../../analysis/range'
import type { WorkerRequest, WorkerResponse, SerializedSolution } from './protocol'

// Vite: `new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' })`
// で読み込まれるWeb Workerのエントリポイント。

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

/** 木を辿ってnodeIdを割り当てながら、各決断ノードの平均戦略をシリアライズ可能な形式で集める。 */
function serializeStrategies(
  node: TreeNode,
  nodeId: string,
  getStrategy: (n: DecisionNode) => { actionLabels: string[]; frequencies: number[][] },
  out: SerializedSolution['strategies'],
): void {
  if (node.kind === 'terminal') return
  if (node.kind === 'decision') {
    const strat = getStrategy(node)
    out[nodeId] = { actionLabels: strat.actionLabels, frequencies: strat.frequencies }
    node.children.forEach((child, i) => {
      serializeStrategies(child, childNodeId(nodeId, node.actionLabels[i]), getStrategy, out)
    })
    return
  }
  // chance
  node.children.forEach((child, i) => {
    serializeStrategies(child, childNodeId(nodeId, `card:${node.cards[i]}`), getStrategy, out)
  })
}

let currentCancelled = false

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.kind === 'cancel') {
    currentCancelled = true
    return
  }

  currentCancelled = false
  const { requestId } = req
  const startTime = performance.now()

  try {
    const tree = buildTurnSubgameTree({
      turnPotBb: req.turnPotBb,
      effectiveStackBb: req.effectiveStackBb,
      firstToAct: req.firstToAct,
      deadCards: req.board,
    })

    const game: CfrGame<Combo> = {
      root: tree,
      players: [
        { hands: req.heroCombos, initialReach: req.heroReach, cards: comboCards },
        { hands: req.villainCombos, initialReach: req.villainReach, cards: comboCards },
      ],
      score: scoreComboOnBoard,
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

    const strategies: SerializedSolution['strategies'] = {}
    serializeStrategies(tree, rootNodeId(), solution.getStrategy, strategies)

    const result: SerializedSolution = {
      iterationsRun: solution.iterationsRun,
      exploitability: solution.exploitability,
      gameValue: solution.gameValue,
      strategies,
    }

    const msg: WorkerResponse = {
      kind: 'result',
      requestId,
      solution: result,
      elapsedMs: performance.now() - startTime,
    }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = {
      kind: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(msg)
  }
}
