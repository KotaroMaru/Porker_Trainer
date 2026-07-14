import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../../engine/types'
import type { WorkerRequest, WorkerResponse } from './protocol'
import './solverWorker'

const posted: WorkerResponse[] = []

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function send(data: WorkerRequest): void {
  self.onmessage?.(new MessageEvent('message', { data }))
}

async function waitForMessage(predicate: (message: WorkerResponse) => boolean): Promise<WorkerResponse> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const found = posted.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Worker response timed out')
}

function solveRequest(requestId: string): WorkerRequest {
  return {
    kind: 'solveStreet',
    requestId,
    street: 'river',
    board: [card(13, 'c'), card(11, 'c'), card(2, 'd'), card(10, 's'), card(4, 'h')],
    oopCombos: [
      [card(14, 'h'), card(14, 's')],
      [card(9, 'd'), card(9, 'h')],
    ],
    oopReach: [1, 1],
    ipCombos: [
      [card(8, 'h'), card(7, 'h')],
      [card(6, 'd'), card(5, 'd')],
    ],
    ipReach: [1, 1],
    potBb: 5.5,
    effectiveStackBb: 10,
    firstToAct: 0,
    maxIterations: 10,
    targetExploitability: -1,
    checkEveryIterations: 5,
  }
}

describe('solverWorker P9-2 session registry', () => {
  beforeEach(() => {
    posted.length = 0
    vi.stubGlobal(
      'postMessage',
      vi.fn((message: WorkerResponse) => {
        posted.push(message)
      }),
    )
  })

  it('存在しないsolveIdのrefineSessionにはerrorを返す', async () => {
    send({
      kind: 'refineSession',
      requestId: 'missing-refine',
      solveId: 'missing',
      targetExploitability: 0.01,
      maxIterations: 100,
      chunkIterations: 10,
    })
    const error = await waitForMessage((message) => message.kind === 'error' && message.requestId === 'missing-refine')
    expect(error).toMatchObject({ kind: 'error', requestId: 'missing-refine' })
  })

  it('既存solveStreetのcancelを次のチェックポイントで反映する', () => {
    const postMessageMock = vi.mocked(self.postMessage)
    postMessageMock.mockImplementation((message: WorkerResponse) => {
      posted.push(message)
      if (message.kind === 'progress' && message.requestId === 'cancel-solve') {
        send({ kind: 'cancel', requestId: 'cancel-solve' })
      }
    })
    send(solveRequest('cancel-solve'))
    const result = posted.find((message) => message.kind === 'result' && message.requestId === 'cancel-solve')
    if (result?.kind !== 'result') throw new Error('cancelled solve did not return a result')
    expect(result.solution.iterationsRun).toBe(5)
  })

  it('複数solveIdを保持し、同一セッションを継続しながらチャンク間のgetNodesに応答する', async () => {
    send(solveRequest('solve-a'))
    const firstResult = posted.find((message) => message.kind === 'result' && message.requestId === 'solve-a')
    if (firstResult?.kind !== 'result') throw new Error(`first solve failed: ${JSON.stringify(posted)}`)

    send(solveRequest('solve-b'))
    const secondResult = posted.find((message) => message.kind === 'result' && message.requestId === 'solve-b')
    expect(secondResult?.kind).toBe('result')
    if (secondResult?.kind !== 'result') throw new Error('second solve failed')
    expect(secondResult.solution.solveId).not.toBe(firstResult.solution.solveId)

    // 新しいsolveStreet後も古いsolveIdがレジストリに残る。
    send({ kind: 'getNodes', requestId: 'old-nodes', solveId: firstResult.solution.solveId, nodeIds: [''] })
    const oldNodes = posted.find((message) => message.kind === 'nodes' && message.requestId === 'old-nodes')
    expect(oldNodes?.kind).toBe('nodes')

    const initialIterations = firstResult.solution.iterationsRun
    const initialExploitability = firstResult.solution.exploitability
    send({
      kind: 'refineSession',
      requestId: 'refine-a',
      solveId: firstResult.solution.solveId,
      targetExploitability: -1,
      maxIterations: 100,
      chunkIterations: 10,
    })
    setTimeout(() => {
      send({ kind: 'getNodes', requestId: 'mid-refine-nodes', solveId: firstResult.solution.solveId, nodeIds: [''] })
    }, 0)

    const midNodes = await waitForMessage((message) => message.kind === 'nodes' && message.requestId === 'mid-refine-nodes')
    const done = await waitForMessage((message) => message.kind === 'refineDone' && message.requestId === 'refine-a')
    expect(posted.indexOf(midNodes)).toBeLessThan(posted.indexOf(done))
    if (midNodes.kind !== 'nodes' || done.kind !== 'refineDone') throw new Error('unexpected response kinds')

    const root = midNodes.nodes['']
    expect(root).not.toBeNull()
    const handCount = 2
    for (let hand = 0; hand < handCount; hand++) {
      let frequencySum = 0
      for (let action = 0; action < root!.actionLabels.length; action++) {
        frequencySum += root!.freqs[action * handCount + hand]
      }
      expect(frequencySum).toBeCloseTo(1, 5)
    }
    expect(root!.evsBb.length).toBe(root!.actionLabels.length * handCount)

    const progress = posted.filter(
      (message): message is Extract<WorkerResponse, { kind: 'refineProgress' }> =>
        message.kind === 'refineProgress' && message.requestId === 'refine-a',
    )
    expect(progress.length).toBeGreaterThan(1)
    expect(progress[0].iterationsRun).toBeGreaterThan(initialIterations)
    expect(done.iterationsRun).toBe(100)
    expect(done.iterationsRun).toBeGreaterThan(progress[0].iterationsRun)
    expect(done.exploitability).toBeLessThan(initialExploitability)
  })

  it('requestId単位のcancelで進行中refineを止め、完了後にprogressを追加しない', async () => {
    send(solveRequest('solve-cancel-base'))
    const result = posted.find((message) => message.kind === 'result' && message.requestId === 'solve-cancel-base')
    if (result?.kind !== 'result') throw new Error('base solve failed')

    const postMessageMock = vi.mocked(self.postMessage)
    postMessageMock.mockImplementation((message: WorkerResponse) => {
      posted.push(message)
      if (message.kind === 'refineProgress' && message.requestId === 'refine-cancel') {
        send({ kind: 'cancel', requestId: 'refine-cancel' })
      }
    })
    send({
      kind: 'refineSession',
      requestId: 'refine-cancel',
      solveId: result.solution.solveId,
      targetExploitability: -1,
      maxIterations: 1_000,
      chunkIterations: 5,
    })

    const done = await waitForMessage((message) => message.kind === 'refineDone' && message.requestId === 'refine-cancel')
    if (done.kind !== 'refineDone') throw new Error('unexpected response kind')
    const progress = posted.filter((message) => message.kind === 'refineProgress' && message.requestId === 'refine-cancel')
    expect(progress).toHaveLength(1)
    expect(done.iterationsRun).toBe(15)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(posted.filter((message) => message.kind === 'refineProgress' && message.requestId === 'refine-cancel')).toHaveLength(1)
  })
})
