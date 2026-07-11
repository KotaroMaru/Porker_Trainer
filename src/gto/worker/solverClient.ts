import type { SolveStreetRequest, GetNodesRequest, WorkerResponse, SolveResultSummary } from './protocol'
import type { DecodedNode } from '../loader/binaryFormat'

export type { SolveResultSummary } from './protocol'

let requestCounter = 0
function nextRequestId(): string {
  requestCounter += 1
  return `req${requestCounter}`
}

export interface SolveHandle {
  /** 解が完成するかキャンセルされるとresolve/rejectするPromise。 */
  promise: Promise<SolveResultSummary>
  /** ソルブを中断する(Workerにキャンセルを通知し、途中経過を破棄する)。 */
  cancel: () => void
}

/**
 * ターン/リバーのライブソルブをWeb Worker上で動かすクライアント(P6 Step B3、
 * プロトコルv2)。solveStreetは戦略/EVそのものは返さず、solveIdと集約結果
 * (収束状況・ゲーム値)のみを返す。実際に必要な決断ノードのデータは
 * getNodesで個別取得する(D2「収穫」パターン、旧v1の全ノード一括
 * シリアライズを廃止)。
 * ハンド終了時にterminate()でWorkerごと破棄することを想定している
 * (P1計画の前提: 1ハンドごとにメモリを解放する)。
 */
export class SolverClient {
  private worker: Worker
  private pending = new Map<
    string,
    {
      resolve: (v: SolveResultSummary) => void
      reject: (err: Error) => void
      onProgress?: (iterationsRun: number, exploitability: number) => void
    }
  >()
  private pendingNodes = new Map<
    string,
    {
      resolve: (nodes: Record<string, DecodedNode | null>) => void
      reject: (err: Error) => void
    }
  >()

  constructor() {
    this.worker = new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handleMessage(ev.data)
    this.worker.onerror = (ev) => {
      // 特定のrequestIdに紐づかない致命的エラー(構文エラー等)。全pendingをreject。
      for (const [, p] of this.pending) p.reject(new Error(ev.message))
      this.pending.clear()
      for (const [, p] of this.pendingNodes) p.reject(new Error(ev.message))
      this.pendingNodes.clear()
    }
  }

  private handleMessage(msg: WorkerResponse) {
    if (msg.kind === 'progress') {
      this.pending.get(msg.requestId)?.onProgress?.(msg.iterationsRun, msg.exploitability)
      return
    }
    if (msg.kind === 'result') {
      const pending = this.pending.get(msg.requestId)
      this.pending.delete(msg.requestId)
      pending?.resolve(msg.solution)
      return
    }
    if (msg.kind === 'nodes') {
      const pending = this.pendingNodes.get(msg.requestId)
      this.pendingNodes.delete(msg.requestId)
      pending?.resolve(msg.nodes)
      return
    }
    // error: solveStreet系・getNodes系どちらのpendingにも該当しうる
    const solvePending = this.pending.get(msg.requestId)
    if (solvePending) {
      this.pending.delete(msg.requestId)
      solvePending.reject(new Error(msg.message))
      return
    }
    const nodesPending = this.pendingNodes.get(msg.requestId)
    if (nodesPending) {
      this.pendingNodes.delete(msg.requestId)
      nodesPending.reject(new Error(msg.message))
    }
  }

  solveStreet(request: Omit<SolveStreetRequest, 'kind' | 'requestId'>, onProgress?: (iterationsRun: number, exploitability: number) => void): SolveHandle {
    const requestId = nextRequestId()
    const promise = new Promise<SolveResultSummary>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress })
    })
    this.worker.postMessage({ ...request, kind: 'solveStreet', requestId } satisfies SolveStreetRequest)
    const cancel = () => {
      this.worker.postMessage({ kind: 'cancel', requestId })
    }
    return { promise, cancel }
  }

  /** solveStreetが返したsolveIdに紐づく決断ノードを、DecodedNode形状で個別取得する。 */
  getNodes(solveId: string, nodeIds: string[]): Promise<Record<string, DecodedNode | null>> {
    const requestId = nextRequestId()
    const promise = new Promise<Record<string, DecodedNode | null>>((resolve, reject) => {
      this.pendingNodes.set(requestId, { resolve, reject })
    })
    this.worker.postMessage({ kind: 'getNodes', requestId, solveId, nodeIds } satisfies GetNodesRequest)
    return promise
  }

  /** Workerを破棄する(メモリ解放)。ハンド終了時に呼ぶこと。 */
  terminate() {
    this.worker.terminate()
    for (const [, p] of this.pending) p.reject(new Error('SolverClient terminated'))
    this.pending.clear()
    for (const [, p] of this.pendingNodes) p.reject(new Error('SolverClient terminated'))
    this.pendingNodes.clear()
  }
}
