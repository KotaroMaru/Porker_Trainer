# tools/solver — GTOフロップ事前計算ツール

このディレクトリは、アプリ本体(`src/`、React + TypeScript)が読み込む`.bin`ソリューション
ファイル(`public/gto/solutions/`)を**ビルド時に一度だけ生成する**ためのRustツール群。
アプリの実行時(ブラウザ)にはこのディレクトリのコードは一切実行されない — アプリが
実際に読むのは、ここで生成された静的な`.bin`ファイルのみ(`src/gto/loader/`参照)。

## ライセンス構成(重要)

このディレクトリ配下には、ライセンスの異なる2つのものが存在する。

### 1. `vendor/postflop-solver/` — AGPL-3.0-or-laterのサードパーティ製ソルバー

[postflop-solver](https://github.com/b-inary/postflop-solver)(b-inary氏、AGPL-3.0-or-later)
の**改変なしの原本**を、`.git`履歴を除いてin-treeでvendorしたもの。

- 出所・固定リビジョン・取得日は`vendor/REV.txt`に記録済み
- 原則として**改変は加えない**。唯一の例外は、当時(2023年)のrustcでは警告のみだった
  構文が後のrustc(1.96.0)ではhard errorになったための**3行の構文互換パッチ**のみ
  (意味論上の変更なし)。詳細は`vendor/REV.txt`内の該当セクションに記載
- ライセンス全文は`vendor/postflop-solver/LICENSE`にそのまま同梱済み
- 開発元は2023年10月からアーカイブ済み(開発停止)のため、rev固定+vendorという形で
  依存を凍結している(アーカイブによる将来的な入手不可リスクを避けるため)

### 2. `crates/precompute/` — このリポジトリ独自のAGPL-3.0-or-laterツール

`vendor/postflop-solver`にRustの依存として直接リンクするCLIツール(`Cargo.toml`で
`license = "AGPL-3.0-or-later"`と明記)。ソルバーの結果を`.bin`ファイルへ書き出す
役割のみを持ち、アプリ本体(`src/`)のコードとは完全に独立している。

このツールを**実行**したり**再配布**したりする場合はAGPL-3.0-or-laterの条件
(改変時のソース公開・著作権表示の保持等)に従うこと。本リポジトリは公開(public)
リポジトリであり、`crates/precompute`と`vendor/postflop-solver`の完全な対応ソースは
常にこのリポジトリ自体から入手可能な状態になっている。

### 3. アプリ本体(`src/`)への影響 — なぜAGPLがアプリ全体に波及しないか

`postflop-solver`(AGPL)は`crates/precompute`という**独立したビルド時CLIツール**の
依存としてのみリンクされる。アプリ本体(React/TSで書かれた`src/`)は:

- `crates/precompute`や`vendor/postflop-solver`のコードを一切import/リンクしない
- ブラウザで実行時に読むのは、precomputeが**事前に**生成した静的な`.bin`バイナリ
  データファイル(`public/gto/solutions/`)のみ
- `.bin`ファイルは「AGPLプログラムの実行結果として出力されたデータ」であり、
  AGPLプログラムのソースコードの複製・改変物ではない(GCCでコンパイルした
  バイナリがGCCのライセンスを継承しないのと同様の関係)
- アプリはWebページとして配信されるが、これは`postflop-solver`(AGPLの対象
  プログラムそのもの)をネットワーク越しに実行させているわけではない
  (AGPLの主眼である「ネットワーク経由でのサービス提供」の条項は、
  precomputeというツールをネットワークサービスとして動かす場合に関係するもので、
  そのツールが吐き出した静的データを別のアプリが読む行為には及ばない)

以上より、アプリ本体(`src/`配下)は本リポジトリの他の部分と同じライセンスのままで
問題ない。ただし`tools/solver/`配下(`crates/precompute`+`vendor/postflop-solver`)を
**単体で**利用・再配布・改変する場合は、AGPL-3.0-or-laterの条件に従う必要がある。

## ディレクトリ構成

```
tools/solver/
├── Cargo.toml              # ワークスペース定義(vendor/postflop-solverはexclude、理由はコメント参照)
├── rust-toolchain.toml     # rustc 1.96.0固定
├── FORMAT.md               # .binフォーマット+nodeId規約の正典(TS/Rust共有)
├── crates/precompute/      # 本ツール本体(AGPL-3.0-or-later)
├── vendor/postflop-solver/ # サードパーティ製ソルバー(AGPL-3.0-or-later、改変最小限)
├── vendor/REV.txt          # vendor元の出所・rev・取得日・改変内容の記録
├── scenarios/*.json        # 17マッチアップのシナリオ定義(手番・レンジ・ポット/スタック)
├── ranges/*.json           # プリフロップレンジ定義
├── crossvalidation/        # Rust↔TS CFR実装の交差検証フィクスチャ
├── ci-plan.mjs             # P8-4: GitHub Actionsバッチのチャンク分割プランニング
└── ci-merge.mjs            # P8-4: GitHub Actionsバッチの結果マージ
```

## ローカルでの実行

```bash
cd tools/solver
cargo build --release -p precompute

# 単一フロップを生成
./target/release/precompute \
  --scenario scenarios/srp_co_vs_bb.json \
  --out ../../public/gto/solutions \
  --flop AsQsJs \
  --max-iter 500 --target-expl 0.005

# シナリオ全体(--resumeで生成済みフロップをスキップ、中断しても再実行で継続)
./target/release/precompute \
  --scenario scenarios/srp_co_vs_bb.json \
  --out ../../public/gto/solutions \
  --resume --max-iter 500 --target-expl 0.005
```

大規模なバッチ生成(全17マッチアップ×95フロップ)は、手元PCを長時間占有しないよう
GitHub Actions(`.github/workflows/gto-batch.yml`、P8-4)経由での実行を推奨する。
Actionsタブから`GTO Solver Batch Generation`をworkflow_dispatchで起動し、
`scenario`(シナリオID)を指定すること。
