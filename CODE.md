# CODE.md — BlackBoard のコード案内

このフォルダのどこに何のコードがあるかの一覧。新しく書く前にここを見て、既にあれば使い回す。作ったら足す。

- 確認日: 2026-10-03。パスの実在は確認済み。内容は調査でファイル冒頭や関数定義まで見た範囲（全文は未読）
- 凡例: 「確認」＝冒頭か関数定義まで見た / 「推定」＝名前や文書からの推測
- 全プロジェクトの導線: `/Users/yottaro/Desktop/dev/Basal/CODE.md`
- 最初に読む文書: `AGENTS.md`。規約は `CLAUDE.md`

## 何のプロジェクトか

アイデアをカプセル（ノード）と線で並べるローカルのボードアプリ。静的HTML、ビルド不要。AIがJSONでボードを編集できる。

## 再利用できるコード

| 場所 | 何をするか / 役に立つ場面 | 状態 |
|---|---|---|
| `board-data.js` | ノード/エッジ型グラフJSONの形式定義と検証（`validateBoard`、`createEmptyBoard`）。DOM非依存でブラウザとNodeの両対応。関係図・因果マップ系の開発に。ノード上限500、エッジ上限2000、関係種別は cause / prevent / premise / relate | 確認 |
| `scripts/blackboard.cjs` | AI向けのファイル編集CLI（152行）。`npm run board -- new\|validate\|summary\|add-node\|rename-node\|move-node\|remove-node\|connect\|disconnect <file> …`。編集前に検証して書き込む。「AIにJSONを安全に編集させる」雛形 | 確認 |
| `scripts/serve.cjs` | 依存なしの簡易静的サーバー（37行、`npm start`、127.0.0.1:8000） | 確認（冒頭） |
| `app.js` | 1614行のキャンバスUI。ズーム/パン（`zoomAt`、`fitView`）、ノード編集、localStorage保存（`loadWorkspace`、`persistWorkspace`）、ダーク/ライト切替 | 確認（関数定義のみ） |
| `board.schema.json`、`examples/project-plan.blackboard.json` | スキーマとサンプル | 確認（実在のみ） |
| `docs/ARCHITECTURE.md`、`docs/BOARD_FORMAT.md` | 編集箇所の表、ボード形式の説明 | 確認（実在のみ） |

## 注意

- `app.js` は単一ファイルの巨大構成。全部読まず、関数名で探す。
- `base.css` と `styles.css` に旧スタイルが残る。有効なのは `minimal.css` 中心。
- ブラウザの状態とJSONは自動同期しない。

## 確かめ方

```bash
cd /Users/yottaro/Desktop/dev/BlackBoard
grep -n "validateBoard" board-data.js
grep -n -E "zoomAt|fitView|persistWorkspace" app.js
```
