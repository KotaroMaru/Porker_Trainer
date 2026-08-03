import { describe, it, expect } from 'vitest'
import { decodeSolutionFile } from '../src/gto/loader/binaryFormat'
import { expectedBytes, opponentReach, effectiveOpponentReach } from './solutionChecks'

// verify-solutions.test.ts が使う検証ロジックを、実データ(.bin)の有無に依存せず
// 常時検証する。バイト列は FORMAT.md セクション4のレイアウトを手組みする
// (src/gto/loader/binaryFormat.test.ts のフィクスチャと同じ流儀)。
//
// フィクスチャの局面(ブロッカー効果を意図的に極端にしている):
//   OOP 2コンボ: AcAd, AcAh  ← どちらも Ac を含む
//   IP  2コンボ: AcAs, KcKd  ← AcAs は Ac を持つのでOOPの全コンボをブロックする
//   木: ""(OOP) → "check"(IP) → "check-bet33"(OOP) → "check-bet33-raise55"(IP)
// OOPは ""(check) と "check-bet33"(raise55) の2回手番を持つので、
// "check-bet33-raise55" でのOOP到達確率は2つの頻度の積になる。

const A = (n: number) => n & 0xff

function buildFixtureBytes(overrides?: { truncateBytes?: number; extraBytes?: number }): ArrayBuffer {
  const bytes: number[] = []
  const pushStr = (s: string) => {
    bytes.push(s.length)
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i))
  }
  const pushU16 = (v: number) => bytes.push(A(v), A(v >> 8))
  const pushU32 = (v: number) => bytes.push(A(v), A(v >> 8), A(v >> 16), A(v >> 24))
  const pushI16 = (v: number) => pushU16(v < 0 ? v + 0x10000 : v)

  // 4.1 ヘッダ
  bytes.push(0x47, 0x54, 0x4f, 0x31) // "GTO1"
  bytes.push(1)
  pushStr('srp_co_vs_bb')
  bytes.push(44, 40, 4) // フロップ(Kc, Qc, 3c 相当。ブロッカー判定には使わない)
  pushU32(55)
  pushU32(975)

  // 4.2 コンボ表: OOP = AcAd(48,49), AcAh(48,50) / IP = AcAs(48,51), KcKd(44,45)
  pushU16(2)
  bytes.push(48, 49, 48, 50)
  pushU16(2)
  bytes.push(48, 51, 44, 45)

  // 4.3 ノード表(dataOffsetは4.4セクション先頭からの相対バイト)
  pushU16(4)
  const node = (id: string, player: 0 | 1, labels: string[], offset: number) => {
    pushStr(id)
    bytes.push(player, labels.length)
    for (const l of labels) pushStr(l)
    pushU32(offset)
  }
  node('', 0, ['check', 'bet33'], 0) // 2アクション×2手 = 4要素 → 4 + 8 = 12バイト
  node('check', 1, ['check', 'bet33'], 12) // 12バイト
  node('check-bet33', 0, ['fold', 'call', 'raise55'], 24) // 6要素 → 6 + 12 = 18バイト
  node('check-bet33-raise55', 1, ['fold', 'call'], 42) // 12バイト

  // 4.4 データ本体
  // node "": OOP check=[255,153]→[1.0,0.6] / bet33=[0,102]→[0.0,0.4]
  bytes.push(255, 153, 0, 102)
  for (const ev of [10, 20, 30, 40]) pushI16(ev)
  // node "check": IPは検証対象外なので任意値
  bytes.push(255, 255, 0, 0)
  for (const ev of [1, 2, 3, 4]) pushI16(ev)
  // node "check-bet33": OOP fold=[204,0] call=[0,0] raise55=[51,255]→[0.2,1.0]
  bytes.push(204, 0, 0, 0, 51, 255)
  for (const ev of [1, 2, 3, 4, 5, 6]) pushI16(ev)
  // node "check-bet33-raise55": IP fold/call
  bytes.push(0, 0, 255, 255)
  for (const ev of [0, 0, 20495, 1435]) pushI16(ev)

  const all = new Uint8Array(bytes)
  if (overrides?.truncateBytes) return all.slice(0, all.length - overrides.truncateBytes).buffer
  if (overrides?.extraBytes) {
    const padded = new Uint8Array(all.length + overrides.extraBytes)
    padded.set(all)
    return padded.buffer
  }
  return all.buffer
}

describe('expectedBytes', () => {
  it('FORMAT.mdセクション4どおりに組んだバイト列の実長と厳密に一致する', () => {
    const buf = buildFixtureBytes()
    const sol = decodeSolutionFile(buf)
    expect(expectedBytes(sol)).toBe(buf.byteLength)
  })

  it('末尾に余分なバイトがあると不一致になる(破損検出)', () => {
    const buf = buildFixtureBytes({ extraBytes: 7 })
    const sol = decodeSolutionFile(buf)
    expect(expectedBytes(sol)).not.toBe(buf.byteLength)
    expect(expectedBytes(sol)).toBe(buf.byteLength - 7)
  })

  it('サイズはコンボ数・ノード数から決まるので、レンジ幅が違えば期待値も変わる', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    const before = expectedBytes(sol)
    // OOPコンボを1つ減らすと、OOP手番ノード(2アクション+3アクション)の
    // データが5要素×3バイト減り、コンボ表も2バイト減る。
    sol.oopCombos.pop()
    expect(expectedBytes(sol)).toBe(before - 2 - (2 + 3) * 3)
  })
})

describe('opponentReach', () => {
  it('ルートノードでは全コンボが到達確率1.0', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    const reach = opponentReach(sol, '', 1)
    expect([...reach]).toEqual([1, 1])
  })

  it('相手が手番の祖先ノードで選んだアクションの頻度だけを掛け合わせる', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    // OOPは ""でcheck(=[1.0, 0.6])、"check-bet33"でraise55(=[0.2, 1.0])。
    // IPが手番の "check" ノードはOOPの到達確率に影響しない。
    const reach = opponentReach(sol, 'check-bet33-raise55', 0)
    expect(reach[0]).toBeCloseTo(1.0 * 0.2, 6)
    expect(reach[1]).toBeCloseTo(0.6 * 1.0, 6)
  })
})

describe('effectiveOpponentReach', () => {
  it('自分の手が相手の継続レンジ全体をブロックするとちょうど0になる', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    // IPの手0 = AcAs。OOPの到達コンボ AcAd / AcAh はどちらも Ac を含むため、
    // IPがAcを持つ限りOOPはこのノードに存在しえない → EVは未定義(0/0)。
    expect(effectiveOpponentReach(sol, 'check-bet33-raise55', 1, 0)).toBe(0)
  })

  it('ブロックしない手では到達確率の総和が正になる(除外は到達不能ケース限定)', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    // IPの手1 = KcKd。OOPの2コンボどちらともカードが重複しない。
    expect(effectiveOpponentReach(sol, 'check-bet33-raise55', 1, 1)).toBeCloseTo(0.2 + 0.6, 6)
  })

  it('相手の頻度が全て0のノードは、ブロックしない手でも到達不能になる', () => {
    const sol = decodeSolutionFile(buildFixtureBytes())
    // "check-bet33" でOOPの call 頻度は両コンボとも0 → その先は到達不能。
    expect(effectiveOpponentReach(sol, 'check-bet33-call', 1, 1)).toBe(0)
  })
})
