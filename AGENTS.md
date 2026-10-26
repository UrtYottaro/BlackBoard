# BlackBoard を編集するエージェントへ

このリポジトリは静的なブラウザアプリです。`index.html` を `file://` で直接開く使い方を維持してください。ビルド処理や外部依存を前提にしないでください。

## 企画ボードを作るとき

- ユーザーが企画や因果関係の整理を頼んだら、まず `.blackboard.json` を成果物として作成・編集してください。アプリ本体のコード変更は必要な場合だけ行います。
- 形式は `docs/BOARD_FORMAT.md`、`board.schema.json`、`examples/project-plan.blackboard.json` を確認してください。カプセルは `nodes`、関係線は `edges` です。
- 可能なら `node scripts/blackboard.cjs` を使います。直接 JSON を編集しても構いませんが、必ず `npm run board -- validate <file>` を実行してください。
- 既存の node ID は名前を変えても保ってください。線の `from` と `to` は存在する node ID を指します。座標は 3000 × 2200 のボード内に収めてください。
- AI が JSON を編集しても、開いているブラウザには自動反映されません。ユーザーに `＝` → `{↑}` で読み込めるファイルを渡してください。既存のボードを残す必要があれば、先にブラウザから書き出します。

## アプリ本体を変えるとき

- `board-data.js` は DOM とストレージに依存しない共有データ層です。ブラウザと CLI の形式をずらさないでください。
- `app.js` は画面操作と `localStorage` の保存を担当します。`blackboard-canvas-v1`、`babel-canvas-v4`、`blackboard-history-v1` は既存データの読み込みに必要です。
- `index.html` では `board-data.js` を `app.js` より先に読み込みます。
- 主要な関数とデータの流れは `docs/ARCHITECTURE.md` にあります。
- 画面変更後は `file://` と `http://127.0.0.1:8000/` で起動確認してください。`npm test` と `node --check app.js` も実行してください。
- ユーザーの既存ボードを消したり、移行なしで保存形式を変えたりしないでください。
