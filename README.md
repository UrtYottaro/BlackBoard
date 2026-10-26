# BlackBoard

アイデアをカプセルとして置き、線で関係を表すローカルのボードです。ブラウザで考えを並べ、Codex や Claude Code には JSON のボードファイルを編集させられます。

## 開く

ブラウザで https://urtyottaro.github.io/BlackBoard/ を開くと、すぐに使えます。

手元で使う場合は、このリポジトリの `index.html` を直接開きます。ローカルサーバーを使う場合は `npm start` を実行し、`http://127.0.0.1:8000/` を開きます。依存パッケージのインストールは不要です。

ボードはブラウザのローカルストレージにだけ保存され、どこにも送信されません。開く場所（公開ページ、`file://`、ローカルサーバー）ごとに保存先が別になります。

## AI とボードをやり取りする

1. 画面右上の `＝` を開き、`{↓}` で現在のボードを `.blackboard.json` として書き出します。
2. Codex または Claude Code に、書き出した JSON ファイルと実現したい企画を伝えます。このフォルダの [AGENTS.md](AGENTS.md) と [CLAUDE.md](CLAUDE.md) に編集手順があります。
3. AI が編集したファイルを `npm run board -- validate path/to/board.blackboard.json` で検証します。
4. 画面右上の `＝` → `{↑}` で編集済み JSON を読み込みます。

ブラウザはボードをローカルストレージに保存します。JSON ファイルとの自動同期はありません。読み込みは現在開いているボードを置き換えるため、残したい内容は先に書き出してください。

画面左下の設定ボタンから操作説明を開き、現在のボードをダークモード／ライトモードに切り替えられます。選んだ外観はボードと一緒に保存され、PNG 書き出しにも反映されます。

## コマンドライン

```sh
npm run board -- new plans/my-project.blackboard.json "新しい企画"
npm run board -- add-node plans/my-project.blackboard.json "課題" --id problem
npm run board -- add-node plans/my-project.blackboard.json "解決策" --id solution --from problem
npm run board -- summary plans/my-project.blackboard.json
npm run board -- validate plans/my-project.blackboard.json
```

`--from` は新しいカプセルと親カプセルを線でつなぎます。すべての操作は `npm run board -- help` で確認できます。例は [examples/project-plan.blackboard.json](examples/project-plan.blackboard.json) にあります。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html`, `minimal.css`, `app.js` | ブラウザの画面と操作。`app.js` は従来の状態管理も担当。 |
| `board-data.js` | ブラウザと CLI が共有するボード形式と検証。DOM に依存しません。 |
| `board.schema.json` | ボード JSON の基本的なスキーマ。 |
| `scripts/blackboard.cjs` | AI がボードファイルを安全に編集する CLI。 |
| `docs/BOARD_FORMAT.md` | フィールド、座標、読み込み時の注意点。 |

ボード形式や画面との関係は [docs/BOARD_FORMAT.md](docs/BOARD_FORMAT.md) を参照してください。
アプリ本体を変更する場合は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) に編集箇所をまとめています。

## ライセンス

[MIT License](LICENSE)
