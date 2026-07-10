// P4 Step 1: シナリオからプリフロップのアクション履歴表示行を再構成する。
// 実際のプリフロップアクションはスクリプト(固定シナリオ)であり、ユーザーの
// 決断は発生しない(P4はフロップ以降のみが対象)。履歴ストリップの最初の列に
// そのまま表示できる形式にする。

import { OPEN_SIZE_BB, THREEBET_SIZE_BB } from '../data/scenarios'
import type { Scenario } from '../types'

export interface PreflopActionLine {
  position: string
  action: string
  amountBb: number
}

/** シナリオのプリフロップ履歴を表示用の行に分解する(SRP=2行、3bet=3行)。 */
export function buildPreflopScript(scenario: Scenario): PreflopActionLine[] {
  const openSize = OPEN_SIZE_BB[scenario.raiser.position]

  if (scenario.kind === 'SRP') {
    return [
      { position: scenario.raiser.position, action: 'レイズ', amountBb: openSize },
      { position: scenario.defender.position, action: 'コール', amountBb: openSize },
    ]
  }

  // THREEBET: raiserがオープン→defender(3ベッター)が3ベット→raiserがコール
  const threebetSize = THREEBET_SIZE_BB[scenario.defender.position]
  return [
    { position: scenario.raiser.position, action: 'レイズ', amountBb: openSize },
    { position: scenario.defender.position, action: '3ベット', amountBb: threebetSize },
    { position: scenario.raiser.position, action: 'コール', amountBb: threebetSize },
  ]
}
