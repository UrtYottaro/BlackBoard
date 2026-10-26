const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const Data = require('../board-data.js');

const cli = path.resolve(__dirname, '../scripts/blackboard.cjs');

test('an empty board and a legacy board are valid', () => {
  const board = Data.createEmptyBoard('企画');
  assert.deepEqual(Data.validateBoard(board), []);
  delete board.formatVersion;
  assert.deepEqual(Data.validateBoard(board), []);
});

test('invalid connections are rejected before import', () => {
  const board = Data.createEmptyBoard();
  board.nodes.push({ id: 'a', name: '', x: 50, y: 50 });
  board.edges.push({ id: 'e', from: 'a', to: 'missing', type: 'cause', label: '' });
  assert.match(Data.validateBoard(board).join(' '), /does not name a node/);
});

test('CLI creates, edits and validates a board file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-test-'));
  const file = path.join(directory, 'plan.blackboard.json');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  try {
    run('new', file, '検証用');
    run('add-node', file, '問題', '--id', 'problem');
    run('add-node', file, '解決', '--id', 'solution', '--from', 'problem');
    run('rename-node', file, 'solution', '改善策');
    assert.match(run('validate', file), /2 nodes, 1 edges/);
    const board = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(board.nodes[1].name, '改善策');
    assert.equal(board.edges[0].from, 'problem');
    assert.equal(board.edges[0].to, 'solution');
    const duplicate = spawnSync(process.execPath, [cli, 'connect', file, 'problem', 'solution'], { encoding: 'utf8' });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /already exists/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), board);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
