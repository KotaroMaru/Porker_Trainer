import { createCfrSession } from '../solver/cfr'
import type { CfrGame, CfrSession, DecisionNode } from '../solver/cfr'
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
// (潜在的性能バグ)を廃止し、Workerがソルブの解(セッション+索引+EV)を
// 保持して、UIがgetNodesで必要なノードだけを個別取得する「収穫」パターン
// (D2)に置き換えた。P9-2ではsolveIdごとのセッションを保持し、別ストリートを
// 解いた後も以前のセッションを継続精密化できる。

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

function cardKeyLocal(c: Card): string {
  return `${c.rank}${c.suit}`
}

let solveCounter = 0
interface StoredSolve {
  session: CfrSession<Combo>
  index: Map<string, DecisionNode>
  evsCache: { iterationsRun: number; evs: Map<DecisionNode, Float32Array> } | null
}

const solveRegistry = new Map<string, StoredSolve>()
const cancelledRequests = new Set<string>()

function decisionEvs(stored: StoredSolve): Map<DecisionNode, Float32Array> {
  if (stored.evsCache?.iterationsRun === stored.session.iterationsRun) return stored.evsCache.evs
  const evs = extractDecisionEvs(stored.session.game, (node) => stored.session.getStrategy(node).frequencies)
  stored.evsCache = { iterationsRun: stored.session.iterationsRun, evs }
  return evs
}

function handleGetNodes(req: Extract<WorkerRequest, { kind: 'getNodes' }>): void {
  const { requestId } = req
  try {
    const stored = solveRegistry.get(req.solveId)
    if (!stored) throw new Error(`getNodes: no session matches solveId "${req.solveId}"`)
    const evs = decisionEvs(stored)
    const nodes: Record<string, DecodedNode | null> = {}
    for (const nodeId of req.nodeIds) {
      nodes[nodeId] = nodeDataAt(stored.index, (node) => stored.session.getStrategy(node), evs, nodeId)
    }
    const msg: WorkerResponse = { kind: 'nodes', requestId, nodes }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = { kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  }
}

function yieldToWorkerEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * P13 Phase E-2: 進捗の送出頻度をexploitability計測(checkEveryIterations、重い)から
 * 切り離す。ターンは50反復中checkEvery=25では2回しか進捗が動かなかった(ユーザー報告の
 * 「解析0%のまま急に完了する」の一因)。exploitability値そのものはprogress messageの
 * 表示側(workerProviderFactory.ts)では使われない(iterationsRunのみ使用)ため、
 * 計測していない間は直近の値を使い回して安全に頻度だけ上げられる。
 */
const PROGRESS_POST_EVERY_ITERATIONS = 5

async function handleSolveStreet(req: Extract<WorkerRequest, { kind: 'solveStreet' }>): Promise<void> {
  cancelledRequests.delete(req.requestId)
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

    const maxIterations = req.maxIterations ?? 500
    const targetExploitability = req.targetExploitability ?? 0.005
    const checkEvery = req.checkEveryIterations ?? 50
    const session = createCfrSession(game)
    let exploitability = Infinity

    while (session.iterationsRun < maxIterations) {
      const current = session.iterationsRun
      const nextCheckpoint = Math.min(Math.ceil((current + 1) / checkEvery) * checkEvery, maxIterations)
      const nextProgressPost = Math.min(current + PROGRESS_POST_EVERY_ITERATIONS, maxIterations)
      const nextStop = Math.min(nextCheckpoint, nextProgressPost)
      session.advance(nextStop - current)

      if (session.iterationsRun % checkEvery === 0 || session.iterationsRun === maxIterations) {
        exploitability = session.measureExploitability()
      }
      const msg: WorkerResponse = { kind: 'progress', requestId, iterationsRun: session.iterationsRun, exploitability }
      self.postMessage(msg)
      if (exploitability < targetExploitability || cancelledRequests.has(requestId)) break

      // P13 Phase E-3: 以前はawaitを一切挟まずworkerを完全ブロックしていたため、
      // ソルブ中は他メッセージ(cancel等)を一切処理できなかった(refineSessionは
      // 既にyieldToWorkerEventLoop()で対策済み、solveStreetだけ未対応だった)。
      await yieldToWorkerEventLoop()
    }

    const index = buildNodeIndex(tree)

    solveCounter += 1
    const solveId = `solve${solveCounter}`
    solveRegistry.set(solveId, { session, index, evsCache: null })

    const resultSummary: SolveResultSummary = {
      solveId,
      iterationsRun: session.iterationsRun,
      exploitability,
      gameValue: session.gameValue(),
    }
    const msg: WorkerResponse = { kind: 'result', requestId, solution: resultSummary, elapsedMs: performance.now() - startTime }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResponse = { kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  } finally {
    cancelledRequests.delete(requestId)
  }
}

async function handleRefineSession(req: Extract<WorkerRequest, { kind: 'refineSession' }>): Promise<void> {
  const { requestId, solveId } = req
  cancelledRequests.delete(requestId)
  try {
    if (!Number.isInteger(req.chunkIterations) || req.chunkIterations <= 0) {
      throw new Error('refineSession: chunkIterations must be a positive integer')
    }
    if (!Number.isInteger(req.maxIterations) || req.maxIterations < 0) {
      throw new Error('refineSession: maxIterations must be a non-negative integer')
    }
    const measureEveryIterations = req.measureEveryIterations ?? 48
    if (!Number.isInteger(measureEveryIterations) || measureEveryIterations <= 0) {
      throw new Error('refineSession: measureEveryIterations must be a positive integer')
    }
    const stored = solveRegistry.get(solveId)
    if (!stored) throw new Error(`refineSession: no session matches solveId "${solveId}"`)

    const { session } = stored
    let exploitability = session.measureExploitability()
    let iterationsSinceMeasurement = 0
    while (
      session.iterationsRun < req.maxIterations &&
      exploitability >= req.targetExploitability &&
      !cancelledRequests.has(requestId)
    ) {
      const iterationsBeforeAdvance = session.iterationsRun
      session.advance(Math.min(req.chunkIterations, req.maxIterations - session.iterationsRun))
      iterationsSinceMeasurement += session.iterationsRun - iterationsBeforeAdvance
      if (iterationsSinceMeasurement >= measureEveryIterations) {
        exploitability = session.measureExploitability()
        iterationsSinceMeasurement = 0
      }
      const progress: WorkerResponse = {
        kind: 'refineProgress',
        requestId,
        solveId,
        iterationsRun: session.iterationsRun,
        exploitability,
      }
      self.postMessage(progress)
      if (
        session.iterationsRun >= req.maxIterations ||
        exploitability < req.targetExploitability ||
        cancelledRequests.has(requestId)
      ) {
        break
      }
      // マクロタスク境界を作り、別solveIdのgetNodesやこのrequestIdのcancelを処理可能にする。
      await yieldToWorkerEventLoop()
    }

    const done: WorkerResponse = {
      kind: 'refineDone',
      requestId,
      solveId,
      iterationsRun: session.iterationsRun,
      exploitability,
    }
    self.postMessage(done)
  } catch (err) {
    const msg: WorkerResponse = { kind: 'error', requestId, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  } finally {
    cancelledRequests.delete(requestId)
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.kind === 'cancel') {
    cancelledRequests.add(req.requestId)
    return
  }
  if (req.kind === 'getNodes') {
    handleGetNodes(req)
    return
  }
  if (req.kind === 'refineSession') {
    void handleRefineSession(req)
    return
  }
  void handleSolveStreet(req)
}
