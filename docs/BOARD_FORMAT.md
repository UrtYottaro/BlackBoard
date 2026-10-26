# BlackBoard のボード形式

ボードは UTF-8 の JSON ファイルです。画面右上のメニューから書き出し・読み込みできます。Codex や Claude Code はこのファイルを直接編集できます。ブラウザ内の保存内容と JSON ファイルは自動同期されないため、AI が編集した後は画面から読み込んでください。

```json
{
  "formatVersion": 1,
  "title": "新しい企画",
  "theme": "dark",
  "nodes": [
    { "id": "idea", "name": "アイデア", "description": "", "x": 400, "y": 300 }
  ],
  "edges": []
}
```

| 項目 | 意味 |
| --- | --- |
| `nodes[].id` | ボード内で一意の識別子。名前を変えても維持する。 |
| `nodes[].name` | カプセルに表示する文字。空文字も可。 |
| `nodes[].description` | 追加メモ。現在の簡易画面では表示しない。 |
| `nodes[].x`, `nodes[].y` | ボード内の位置。左上を原点とするピクセル座標。 |
| `edges[].from`, `edges[].to` | 接続するノードの ID。方向は `from` → `to`。 |
| `edges[].type` | `cause`, `prevent`, `premise`, `relate` のいずれか。 |
| `edges[].label` | 線の補助ラベル。現在の簡易画面では表示しない。 |

ボード領域は 3000 × 2200 ピクセルです。最大 500 ノード、2000 接続です。`formatVersion` のない以前の書き出しファイルも読み込めます。追加フィールドは保存時に維持します。

`board.schema.json` は基本的な型の定義です。ノード ID の重複や存在しないノードへの接続は `board-data.js` が検証します。編集後は次を実行してください。

```sh
npm run board -- validate path/to/board.blackboard.json
```

CLI の追加・接続操作は一時ファイルを書いてから置き換えるため、途中で壊れた JSON を残しにくくしています。ブラウザ内の既存ボードを上書きせずに確認したい場合は、最初に新しいボードを作ってから JSON を読み込んでください。
