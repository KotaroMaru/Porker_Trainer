# GTOフロップ事前計算 — TS/Rust共有フォーマット正典

このファイルはP3(Rust事前計算パイプライン)で生成される`.bin`ソリューションファイルの
フォーマットと、TS側(`src/gto/`)・Rust側(`tools/solver/crates/precompute/`)が共有する
規約を定義する**唯一の正典**。両実装はこのドキュメントに従うこと。齟齬が見つかった場合は
本ファイルを先に更新してから両実装を追従させる。

## 1. カードID規約

TS側は`cardKey(card) = `${rank}${suit}`` (`src/engine/deck.ts`)、rank=2..14
(2..10, J=11, Q=12, K=13, A=14)、suit∈{'c','d','h','s'}の文字列表現を内部で使う。

Rust側(postflop-solver)は `card_id = 4*rustRank + suitIndex` の整数表現を使う
(rustRank=0..12、suitIndex: c=0,d=1,h=2,s=3)。

変換:
```
rustRank = tsRank - 2          // tsRank: 2..14 → rustRank: 0..12
suitIndex = ['c','d','h','s'].indexOf(suit)   // TS Suit型の定義順と一致
card_id = 4 * rustRank + suitIndex            // 0..51
```
逆変換:
```
tsRank = Math.floor(card_id / 4) + 2
suit = ['c','d','h','s'][card_id % 4]
```

`.bin`ファイル内のカードは**rust形式の`card_id`(0..51, u8)**で格納する(理由: Rust側が
そのまま出力でき、TS側は上記の逆変換1回で済むため)。

## 2. コンボ順序

Rust側 `game.private_cards(player)` は `(card1, card2)` を `card1 < card2` の
辞書順(card1を0..51で昇順に固定し、各card1についてcard2をcard1+1..51で昇順)で
返す。この順序を「rustコンボ順」と呼び、`.bin`ファイルのコンボ表・頻度/EV配列は
すべてこの順序に従う。

TS側はコンボの集合をこの順序に依存しない形(`Combo = [Card, Card]`の配列)で保持して
いるため、ローダ側(`src/gto/loader/binaryFormat.ts`)で**ファイルが自己記述する
コンボ表**(セクション3のヘッダ参照)を読み、`(card_id, card_id) → Combo`の対応付けを
毎回その場で構築する。TS側の配列順序に依存しないため、両者の生成順が一致している
ことを前提にしない(構造的にバグを排除する設計)。

## 3. ノードID(アクション履歴)規約

`src/gto/tree/nodeId.ts`のエンコードをそのまま正典とする:
- ルートノード(フロップの最初の決断): 空文字列 `""`
- 子ノード: `親ID + "-" + アクションラベル` (親がルートの場合は`アクションラベル`のみ)
- 例: `"check-bet33-call"` (OOPがチェック→IPがbet33%→OOPがコール、ただしコールは
  ターミナルなのでノードIDとしては直前の決断ノードまでを指す)

### アクションラベル語彙(`src/gto/tree/actionTree.ts`と完全一致させること)

| ラベル | 意味 | 出現する文脈 |
|---|---|---|
| `check` | チェック | 誰もベットしていない状態 |
| `bet33` | 33%ポットベット | 誰もベットしていない状態 |
| `bet75` | 75%ポットベット | 誰もベットしていない状態 |
| `fold` | フォールド | ベット/レイズに直面した状態 |
| `call` | コール(コールフォーレス含む) | ベット/レイズに直面した状態 |
| `raise55` | 55%ポットレイズ(コール分を除いた追加額基準) | 未レイズのベットに直面した状態のみ |
| `allin` | オールイン(ベット・レイズ・再レイズいずれの文脈でも) | 全ての意思決定ノードで到達しうる |

**2026-07-04仕様更新**: レイズに直面した側は `fold` / `call` / `allin`(オールイン再レイズ)
の3択を持つ(サイズドの再レイズは提示しない)。オールインに直面した側は`fold`/`call`のみ
(相手に残りスタックがなく、連鎖が構造的に止まる)。

Rust側でこのラベルを再構成する際は、`Action::Fold→fold`, `Action::Check→check`,
`Action::Call→call`, `Action::AllIn(_)→allin`, `Action::Bet(x)`は現在ポットに対する
比率が33%/75%のどちらに近いかで`bet33`/`bet75`に、`Action::Raise(x)`は`raise55`に
マッピングする(Step 3の`ActionTree`設定で本抽象と一致する行のみが生成されるように
`TreeConfig`のベット/レイズオプションを絞り込むため、原則としてマッピングは一意に定まる
はず。乖離が生じた場合はエラーとして`--debug-json`に出力し人手で確認する)。

## 4. `.bin`ファイルレイアウト

1ファイル = 1(マッチアップ, フロップ)の組。パスは
`public/gto/solutions/{scenarioId}/{flopId}.bin`。

全体は以下のセクションを順に連結したバイナリ(リトルエンディアン)。

### 4.1 ヘッダ
| フィールド | 型 | 説明 |
|---|---|---|
| magic | `u8[4]` | ASCII `"GTO1"` |
| version | `u8` | フォーマットバージョン(現在1) |
| scenarioId長 | `u8` | 続くASCII文字列のバイト数 |
| scenarioId | `u8[]` | ASCII文字列(例: `"srp_btn_vs_bb"`) |
| flop | `u8[3]` | rust形式card_id、3枚 |
| startingPotChips | `u32` | 開始ポット(0.1bb単位の整数チップ。例: 5.5bb→55) |
| effectiveStackChips | `u32` | 実効スタック(同上) |

### 4.2 コンボ表(OOP→IPの順)
各プレイヤーについて:
| フィールド | 型 | 説明 |
|---|---|---|
| コンボ数 | `u16` | このプレイヤーのレンジに含まれるコンボ数 |
| コンボ | `(u8,u8)[]` | 各コンボの2枚のcard_id(card1<card2、rustコンボ順で昇順) |

このコンボ表の**配列インデックス**が、以降のノードデータにおける「コンボインデックス」
として使われる(ファイル自己記述、セクション2参照)。

### 4.3 ノード表
| フィールド | 型 | 説明 |
|---|---|---|
| ノード数 | `u16` | |
| (各ノード) nodeId長 | `u8` | |
| (各ノード) nodeId | `u8[]` | ASCII、セクション3のエンコード |
| (各ノード) player | `u8` | 0=OOP、1=IP |
| (各ノード) actionCount | `u8` | |
| (各ノード, 各アクション) ラベル長 | `u8` | |
| (各ノード, 各アクション) ラベル | `u8[]` | ASCII、セクション3の語彙 |
| (各ノード) dataOffset | `u32` | セクション4.4内でのバイトオフセット |

### 4.4 データ本体
ノード表の各ノードについて、`dataOffset`位置から連続して:
- `freq: u8[actionCount × handCount]` — action-major(`freq[a*handCount+h]`)。
  `0..255`を`0..1`にマップ(`v/255`)。`handCount`はそのノードの手番側プレイヤーの
  コンボ数(セクション4.2のコンボ数と一致)
- `ev: i16[actionCount × handCount]` — 同レイアウト。0.01bb刻みの符号付き整数
  (±327.67bbまで表現可能。実効スタック100bb運用では十分な余裕)

### 4.5 EVの基準点規約
（Step 3実装時に実証確認した内容をここに記録する。現時点の想定: `expected_values_detail`
はそのノードの手番側視点でのショーダウン込み絶対EV(チップ単位、starting_pot/2相当の
バイアスを含む)であり、`.bin`にはbb換算(`÷10`)で格納する。アプリ側の採点は同一ノード内の
アクション間EV差分のみを使うため、基準点の取り方(定数オフセット)自体は結果に影響しない。）

## 5. シナリオ側の対応(Step 2で生成する`tools/solver/scenarios/*.json`)

各シナリオJSONは以下を持つ(生成元: `src/gto/data/{scenarios,ranges,flops}.ts`):
```jsonc
{
  "scenarioId": "srp_btn_vs_bb",
  "oopRangeStr": "...",      // PioSOLVER形式のレンジ文字列(OOP側)
  "ipRangeStr": "...",       // 同IP側
  "startingPotChips": 55,    // potBb × 10
  "effectiveStackChips": 975,
  "flops": ["Qh8d3c", "..."] // rust形式カード文字列(a-h/A/K/Q/J/T/9..2 + suit)、95件
}
```
OOP/IP判定はポストフロップの行動順(SB<BB<UTG<HJ<CO<BTNの早い方がOOP)で決定する。

## 6. 変更履歴
- 2026-07-04: 初版作成(P3 Step 1)。actionTree.tsのオールイン再レイズ仕様変更(P2.5)を反映。
