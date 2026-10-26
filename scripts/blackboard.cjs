#!/usr/bin/env node
/* File-based entry point for Codex, Claude Code, and other local agents. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Data = require('../board-data.js');

function usage() {
  console.log(`BlackBoard board file commands

  node scripts/blackboard.cjs new <file> [title]
  node scripts/blackboard.cjs validate <file>
  node scripts/blackboard.cjs summary <file>
  node scripts/blackboard.cjs title <file> <title>
  node scripts/blackboard.cjs add-node <file> <text> [--id ID] [--x N] [--y N] [--from ID]
  node scripts/blackboard.cjs rename-node <file> <node-id> <text>
  node scripts/blackboard.cjs move-node <file> <node-id> <x> <y>
  node scripts/blackboard.cjs remove-node <file> <node-id>
  node scripts/blackboard.cjs connect <file> <from-id> <to-id> [--type cause|prevent|premise|relate] [--label TEXT] [--id ID]
  node scripts/blackboard.cjs disconnect <file> <edge-id>

All edits validate the graph before replacing the file. The browser keeps its own
local copy; use its top-right JSON buttons to export and import board files.`);
}

function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || !allowed.includes(key.slice(2)) || args[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${key || '(missing)'}`);
    }
    options[key.slice(2)] = args[index + 1];
  }
  return options;
}

function readBoard(file) {
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = Data.validateBoard(board);
  if (errors.length) throw new Error(errors.join('\n'));
  return board;
}

function writeBoard(file, board) {
  const errors = Data.validateBoard(board);
  if (errors.length) throw new Error(errors.join('\n'));
  const target = path.resolve(file);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(board, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function uniqueId(prefix, used) {
  let id;
  do { id = `${prefix}-${randomUUID().slice(0, 8)}`; } while (used.has(id));
  return id;
}

function findNode(board, id) {
  const node = board.nodes.find(item => item.id === id);
  if (!node) throw new Error(`Node not found: ${id}`);
  return node;
}

function number(value, name) {
  const result = Number(value);
  if (value === undefined || value === '' || !Number.isFinite(result)) throw new Error(`${name} must be a finite number.`);
  return result;
}

function run(argv) {
  const [command, file, ...args] = argv;
  if (!command || command === 'help' || command === '--help') { usage(); return; }
  if (!file) throw new Error('Board file path is required. Run: node scripts/blackboard.cjs help');

  if (command === 'new') {
    const board = Data.createEmptyBoard(args.join(' '));
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(board, null, 2) + '\n', { flag: 'wx' });
    console.log(`Created ${file}`);
    return;
  }

  const board = readBoard(file);
  if (command === 'validate') { console.log(`Valid: ${board.nodes.length} nodes, ${board.edges.length} edges`); return; }
  if (command === 'summary') {
    console.log(`${board.title || '(untitled)'} — ${board.nodes.length} nodes, ${board.edges.length} edges`);
    for (const node of board.nodes) console.log(`  ${node.id}: ${node.name || '(blank)'}`);
    for (const edge of board.edges) console.log(`  ${edge.from} -> ${edge.to} [${edge.type}]${edge.label ? ` ${edge.label}` : ''}`);
    return;
  }

  if (command === 'title') {
    if (!args.length) throw new Error('New title is required.');
    board.title = args.join(' ');
  } else if (command === 'add-node') {
    const [name, ...optionArgs] = args;
    if (name === undefined || name.startsWith('--')) throw new Error('Node text is required. Use "" for a blank capsule.');
    const options = parseOptions(optionArgs, ['id', 'x', 'y', 'from']);
    const parent = options.from ? findNode(board, options.from) : null;
    const siblingCount = parent ? board.edges.filter(edge => edge.from === parent.id).length : 0;
    const index = board.nodes.length;
    const id = options.id || uniqueId('node', new Set(board.nodes.map(node => node.id)));
    const x = options.x === undefined ? (parent ? Math.min(2850, parent.x + 220) : 160 + (index % 5) * 300) : number(options.x, 'x');
    const y = options.y === undefined ? (parent ? Math.min(2100, parent.y + siblingCount * 110) : 150 + Math.floor(index / 5) * 140) : number(options.y, 'y');
    board.nodes.push({ id, name, description: '', x, y });
    if (parent) board.edges.push({ id: uniqueId('edge', new Set(board.edges.map(edge => edge.id))), from: parent.id, to: id, type: 'cause', label: '' });
    writeBoard(file, board);
    console.log(`Added node ${id}`);
    return;
  } else if (command === 'rename-node') {
    if (args.length < 2) throw new Error('Node ID and new text are required.');
    findNode(board, args[0]).name = args.slice(1).join(' ');
  } else if (command === 'move-node') {
    if (args.length !== 3) throw new Error('Node ID, x, and y are required.');
    const node = findNode(board, args[0]);
    node.x = number(args[1], 'x');
    node.y = number(args[2], 'y');
  } else if (command === 'remove-node') {
    if (args.length !== 1) throw new Error('Node ID is required.');
    findNode(board, args[0]);
    board.nodes = board.nodes.filter(node => node.id !== args[0]);
    board.edges = board.edges.filter(edge => edge.from !== args[0] && edge.to !== args[0]);
  } else if (command === 'connect') {
    const [from, to, ...optionArgs] = args;
    if (!from || !to) throw new Error('From and to node IDs are required.');
    findNode(board, from); findNode(board, to);
    if (from === to) throw new Error('A node cannot connect to itself.');
    if (board.edges.some(edge => edge.from === from && edge.to === to)) throw new Error('This directed connection already exists.');
    const options = parseOptions(optionArgs, ['id', 'type', 'label']);
    board.edges.push({
      id: options.id || uniqueId('edge', new Set(board.edges.map(edge => edge.id))),
      from, to, type: options.type || 'cause', label: options.label || ''
    });
  } else if (command === 'disconnect') {
    if (args.length !== 1) throw new Error('Edge ID is required.');
    if (!board.edges.some(edge => edge.id === args[0])) throw new Error(`Edge not found: ${args[0]}`);
    board.edges = board.edges.filter(edge => edge.id !== args[0]);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  writeBoard(file, board);
  console.log(`Updated ${file}`);
}

try { run(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
