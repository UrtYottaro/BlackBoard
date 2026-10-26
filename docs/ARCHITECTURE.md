# BlackBoard の構成

ビルド不要の静的アプリです。`index.html` が `board-data.js`、次に `app.js` を読み込みます。`minimal.css` が現在の画面を中心に上書きし、`base.css` と `styles.css` には以前の画面のスタイルも残っています。画面を直す前に、実際に有効なセレクタを確認してください。

## データの流れ

```text
.blackboard.json ←→ 画面の JSON 書き出し・読み込み
                         ↓
                    app.js の state
                         ↓
               localStorage のボード履歴
```

ブラウザの状態とファイルは自動同期されません。`state` は現在表示中のボードです。`workspace.boards` は履歴で、各要素の `state` がボード本体です。`saveState()` が現在の状態を履歴に反映し、少し待ってから `persistWorkspace()` が保存します。`loadWorkspace()` は既存データを読むので、保存キーを変更する際は移行処理が必要です。

## 編集箇所の目安

| 変更したいこと | 主な場所 |
| --- | --- |
| JSON 形式、入力検証 | `board-data.js`、`board.schema.json`、`tests/board-data.test.cjs` |
| AI からファイルを作成・編集 | `scripts/blackboard.cjs` |
| JSON 読み書きボタン | `index.html` の `exportMenu`、`app.js` の `exportBoardJson()` と `importFile` のハンドラ |
| カプセルの表示・文字編集 | `app.js` の `renderNodes()`、`beginNodeEdit()`、`minimal.css` |
| カプセルの追加位置・分裂 | `positionForChild()`、`addChildNode()`、`animateSplit()` |
| 線の位置・形 | `edgeGeometry()`、`drawEdges()` |
| 拡大縮小・移動・中央表示 | `transformWorld()`、`zoomAt()`、`centerOnNode()` |
| 履歴と複数ボード | `renderBoardHistory()`、`switchBoard()`、`createBoard()` |
| PNG 書き出し | `createPngBlob()`、`exportPng()` |
| 左下の設定・操作説明・表示モード | `index.html` の `settingsMenu` と `helpModal`、`app.js` の `setSettingsOpen()`・`setTheme()`・`applyTheme()`、`minimal.css` の `body.light` 系 |

`app.js` は既存の画面操作をまとめたファイルです。変更は関連する関数に限定し、ブラウザと CLI が共有する仕様は `board-data.js` に置いてください。JSON 形式の詳細は [BOARD_FORMAT.md](BOARD_FORMAT.md) を参照してください。

## 確認

```sh
npm test
node --check app.js
npm run board -- validate examples/project-plan.blackboard.json
npm start
```

`npm start` は `127.0.0.1:8000` にローカルサーバーを立てます。ブラウザでは JSON の読み込み・書き出しと、既存のカプセル操作を確認してください。
