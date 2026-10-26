const APP_NAME = 'BlackBoard';
const STORAGE_KEY = 'blackboard-canvas-v1';
const LEGACY_STORAGE_KEY = 'babel-canvas-v4';
const WORKSPACE_KEY = 'blackboard-history-v1';
const BOARD_WIDTH = 3000;
const BOARD_HEIGHT = 2200;
const NODE_HEIGHT = 48;
const NODE_CHARS_PER_LINE = 15;
const NODE_LINE_HEIGHT = 20;
// 禁則処理。行頭に来てはいけない字（句読点・閉じかっこ・小書きの仮名・長音など）と、
// 行末に残してはいけない字（開きかっこ）
const NO_LINE_START = new Set(Array.from('、。，．,.・：；:;？！?!‼⁇⁈⁉）)］]｝}〕〉》」』】〙〗〟’”»ゝゞヽヾ々〻ーぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ‐゠–〜～…‥'));
const NO_LINE_END = new Set(Array.from('（(［[｛{〔〈《「『【〘〖〝‘“«'));
function nodeLines(name) {
  const characters = Array.from(String(name || '').replace(/[\r\n]/g, ''));
  if (!characters.length) return [''];
  const lines = [];
  for (let i = 0; i < characters.length;) {
    let end = Math.min(i + NODE_CHARS_PER_LINE, characters.length);
    if (end < characters.length && NO_LINE_START.has(characters[end])) {
      // 次の行の頭が禁則の字なら、1字だけ今の行にぶら下げる（幅は280pxに収まる）。
      // 2字以上続くとぶら下げきれないので、前の字ごと次の行へ追い出す
      if (end + 1 >= characters.length || !NO_LINE_START.has(characters[end + 1])) end += 1;
      else while (end - i > 1 && NO_LINE_START.has(characters[end])) end -= 1;
    }
    // 開きかっこで行が終わるなら、次の行へ送る
    while (end < characters.length && end - i > 1 && NO_LINE_END.has(characters[end - 1])) end -= 1;
    lines.push(characters.slice(i, end).join(''));
    i = end;
  }
  return lines;
}
const nodeText = name => nodeLines(name).join('\n');
const nodeHeight = name => NODE_HEIGHT + (nodeLines(name).length - 1) * NODE_LINE_HEIGHT;
const nodeMeasure = document.createElement('canvas').getContext('2d');
if (nodeMeasure) nodeMeasure.font = '500 14px Inter, -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif';
const nodeLineWidths = new Map();
function nodeLineWidth(line) {
  if (nodeLineWidths.has(line)) return nodeLineWidths.get(line);
  const width = nodeMeasure ? nodeMeasure.measureText(line).width : Array.from(line).length * 15;
  if (nodeLineWidths.size > 1024) nodeLineWidths.clear();
  nodeLineWidths.set(line, width);
  return width;
}
const nodeWidth = name => Math.max(92, Math.min(280, 54 + Math.max(...nodeLines(name).map(nodeLineWidth))));
const RELATIONS = BlackBoardData.RELATIONS;
const SEED = BlackBoardData.createEmptyBoard();

const $ = id => document.getElementById(id);
const canvas = $('canvas'), world = $('world'), nodeLayer = $('nodeLayer'), edgeLayer = $('edgeLayer'), selectionMarquee = $('selectionMarquee');
const cutOverlay = $('cutOverlay'), cutLine = $('cutLine');
let workspace = loadWorkspace();
let state = activeBoard().state;
let selected = null;
let selectedNodeIds = new Set();
const growingNodeHeights = new Map();
let nodeGrowthFrame = null;
let linkStartId = null;
let connectFrom = null;
let connectMode = false;
let transform = { x: 0, y: 0, scale: 1 };
let gesture = null;
let threeFingerPan = null;
let saveTimer = null;
let toastTimer = null;
let searchTerm = '';
let zoomMotion = null;
let zoomFrame = 0;
let panMotion = null;
let panFrame = 0;
let zoomCursor = null;
let viewSaveTimer = null;
let lastNodePointerDown = null;
let clickBurst = null;
let revealedHistoryBoardId = null;
let revealedHistorySide = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (validState(parsed)) return parsed;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (validState(legacy)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy)); } catch (_) { /* Use the existing board if storage is full. */ }
      return legacy;
    }
  } catch (_) { /* The sample board still works when local storage is unavailable. */ }
  return clone(SEED);
}
function validState(value) {
  return BlackBoardData.isValidBoard(value);
}
function loadWorkspace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_KEY));
    if (Array.isArray(parsed?.boards)) {
      const ids = new Set();
      const boards = parsed.boards.filter(board => {
        if (!board || typeof board.id !== 'string' || ids.has(board.id) || !validState(board.state)) return false;
        ids.add(board.id);
        return true;
      }).slice(0, 200);
      if (boards.length) {
        const activeBoardId = boards.some(board => board.id === parsed.activeBoardId) ? parsed.activeBoardId : boards[0].id;
        return { activeBoardId, boards };
      }
    }
  } catch (_) { /* Keep the previous single board available if history cannot be read. */ }
  const now = Date.now();
  const id = uid('board');
  return { activeBoardId: id, boards: [{ id, state: loadState(), createdAt: now, updatedAt: now, view: null }] };
}
function activeBoard() { return workspace.boards.find(board => board.id === workspace.activeBoardId); }
function persistWorkspace() {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    $('saveStatus').textContent = '保存済み';
    $('saveStatus').classList.remove('saving');
  } catch (_) {
    $('saveStatus').textContent = '保存できません';
  }
}
function saveState() {
  const board = activeBoard();
  board.state = state;
  board.updatedAt = Date.now();
  $('saveStatus').textContent = '保存中…';
  $('saveStatus').classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistWorkspace();
    renderBoardHistory();
  }, 280);
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function uid(prefix) { return prefix + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
function getNode(id) { return state.nodes.find(n => n.id === id); }
function getEdge(id) { return state.edges.find(e => e.id === id); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2700); }
function updateCounts() { $('countLabel').textContent = `${state.nodes.length} 個の単語 · ${state.edges.length} 個の関係`; }

function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  $('themeSwitch').checked = state.theme === 'light';
  $('themeSwitch').setAttribute('aria-checked', String(state.theme === 'light'));
  document.querySelector('meta[name="theme-color"]').content = state.theme === 'light' ? '#f3f4f6' : '#111214';
  $('themeButton').innerHTML = state.theme === 'light'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z"/></svg>';
  drawEdges();
}
function updateTitle() {
  $('boardTitle').value = state.title;
  $('heroTitle').textContent = state.title || '無題のキャンバス';
  $('sidebarBoardName').textContent = state.title || '無題のキャンバス';
  document.title = state.title ? `${state.title} — ${APP_NAME}` : APP_NAME;
}
function minimumBoardScale() {
  return Math.max(.35, canvas.clientWidth / BOARD_WIDTH, canvas.clientHeight / BOARD_HEIGHT);
}
function boundedBoardPosition(scale, x, y) {
  return {
    x: Math.max(Math.min(0, canvas.clientWidth - BOARD_WIDTH * scale), Math.min(0, x)),
    y: Math.max(Math.min(0, canvas.clientHeight - BOARD_HEIGHT * scale), Math.min(0, y))
  };
}
function transformWorld() {
  const minimumScale = minimumBoardScale();
  if (transform.scale < minimumScale) {
    const centerX = (canvas.clientWidth / 2 - transform.x) / transform.scale;
    const centerY = (canvas.clientHeight / 2 - transform.y) / transform.scale;
    transform.scale = minimumScale;
    transform.x = canvas.clientWidth / 2 - centerX * minimumScale;
    transform.y = canvas.clientHeight / 2 - centerY * minimumScale;
  }
  const bounded = boundedBoardPosition(transform.scale, transform.x, transform.y);
  transform.x = bounded.x;
  transform.y = bounded.y;
  world.style.transform = `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`;
  $('zoomValue').textContent = `${Math.round(transform.scale * 100)}%`;
  activeBoard().view = { ...transform };
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(persistWorkspace, 450);
}
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left - transform.x) / transform.scale, y: (clientY - rect.top - transform.y) / transform.scale };
}
function zoomAnchor(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  if (inside(clientX, clientY) && (clientX !== 0 || clientY !== 0 || !zoomCursor)) return { x: clientX, y: clientY };
  if (zoomCursor && inside(zoomCursor.x, zoomCursor.y)) return zoomCursor;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
function stopZoomMotion() {
  if (zoomFrame) cancelAnimationFrame(zoomFrame);
  zoomFrame = 0;
  zoomMotion = null;
}
function stopPanMotion() {
  if (panFrame) cancelAnimationFrame(panFrame);
  panFrame = 0;
  panMotion = null;
}
function animatePan(now) {
  if (!panMotion) { panFrame = 0; return; }
  const progress = Math.min(1, (now - panMotion.startedAt) / panMotion.duration);
  const eased = progress * progress * (3 - 2 * progress);
  transform.x = panMotion.startX + (panMotion.targetX - panMotion.startX) * eased;
  transform.y = panMotion.startY + (panMotion.targetY - panMotion.startY) * eased;
  transformWorld();
  if (progress === 1) {
    panMotion = null;
    panFrame = 0;
    return;
  }
  panFrame = requestAnimationFrame(animatePan);
}
function panByTrackpad(deltaX, deltaY) {
  stopZoomMotion();
  stopPanMotion();
  transform.x -= deltaX;
  transform.y -= deltaY;
  transformWorld();
}
function animateZoom() {
  if (!zoomMotion) { zoomFrame = 0; return; }
  const error = zoomMotion.targetScale - transform.scale;
  const desiredVelocity = error * .16;
  zoomMotion.velocity += (desiredVelocity - zoomMotion.velocity) * .24;
  let next = transform.scale + zoomMotion.velocity;
  if ((error > 0 && next >= zoomMotion.targetScale) || (error < 0 && next <= zoomMotion.targetScale) || (Math.abs(error) < .0002 && Math.abs(zoomMotion.velocity) < .0002)) {
    next = zoomMotion.targetScale;
  }
  transform.scale = next;
  transform.x = zoomMotion.px - zoomMotion.worldX * next;
  transform.y = zoomMotion.py - zoomMotion.worldY * next;
  transformWorld();
  if (next === zoomMotion.targetScale) {
    zoomMotion = null;
    zoomFrame = 0;
    return;
  }
  zoomFrame = requestAnimationFrame(animateZoom);
}
function zoomAt(factor, clientX, clientY) {
  stopPanMotion();
  const rect = canvas.getBoundingClientRect();
  const anchor = zoomAnchor(clientX, clientY);
  const px = anchor.x - rect.left, py = anchor.y - rect.top;
  const baseScale = zoomMotion?.targetScale ?? transform.scale;
  const targetScale = Math.max(minimumBoardScale(), Math.min(Math.max(2.2, minimumBoardScale()), baseScale * factor));
  zoomMotion = {
    targetScale,
    px,
    py,
    worldX: (px - transform.x) / transform.scale,
    worldY: (py - transform.y) / transform.scale,
    velocity: zoomMotion?.velocity ?? 0
  };
  if (!zoomFrame) zoomFrame = requestAnimationFrame(animateZoom);
}
function fitView() {
  stopZoomMotion();
  stopPanMotion();
  if (!state.nodes.length) { transform = { x: canvas.clientWidth / 2 - BOARD_WIDTH / 2, y: canvas.clientHeight / 2 - BOARD_HEIGHT / 2, scale: 1 }; transformWorld(); return; }
  const minX = Math.min(...state.nodes.map(n => n.x));
  const maxX = Math.max(...state.nodes.map(n => n.x + nodeWidth(n.name)));
  const minY = Math.min(...state.nodes.map(n => n.y));
  const maxY = Math.max(...state.nodes.map(n => n.y + nodeHeight(n.name)));
  const padX = Math.min(100, canvas.clientWidth * .1), padY = Math.min(100, canvas.clientHeight * .14);
  const minScale = minimumBoardScale();
  const scale = Math.max(minScale, Math.min(1.15, (canvas.clientWidth - padX * 2) / Math.max(200, maxX - minX), (canvas.clientHeight - padY * 2) / Math.max(160, maxY - minY)));
  transform = { scale, x: (canvas.clientWidth - (maxX - minX) * scale) / 2 - minX * scale, y: (canvas.clientHeight - (maxY - minY) * scale) / 2 - minY * scale };
  transformWorld();
}
function centerOnNode(id) {
  stopZoomMotion();
  stopPanMotion();
  const n = getNode(id); if (!n) return;
  const target = boundedBoardPosition(
    transform.scale,
    canvas.clientWidth / 2 - (n.x + nodeWidth(n.name) / 2) * transform.scale,
    canvas.clientHeight / 2 - (n.y + nodeHeight(n.name) / 2) * transform.scale
  );
  const distance = Math.hypot(target.x - transform.x, target.y - transform.y);
  if (distance < 1) return;
  panMotion = {
    startX: transform.x,
    startY: transform.y,
    targetX: target.x,
    targetY: target.y,
    duration: Math.min(750, Math.max(240, 220 + distance * .27)),
    startedAt: performance.now()
  };
  panFrame = requestAnimationFrame(animatePan);
}

function createNodeElement(n) {
  const el = document.createElement('div');
  el.className = nodeLines(n.name).length > 1 ? 'node multiline' : 'node';
  el.dataset.id = n.id;
  el.style.left = `${n.x}px`; el.style.top = `${n.y}px`;
  el.style.width = `${nodeWidth(n.name)}px`;
  el.style.height = `${nodeHeight(n.name)}px`;
  el.innerHTML = `<div class="node-body"><div class="node-title" contenteditable="false" spellcheck="false"></div><div class="node-description"></div></div>`;
  el.querySelector('.node-title').textContent = nodeText(n.name);
  el.querySelector('.node-description').textContent = n.description || 'メモを追加';
  el.addEventListener('pointerdown', onNodePointerDown);
  el.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    beginNodeEdit(n.id, { x: event.clientX, y: event.clientY });
    placeEditorCaretAtPoint(el.querySelector('.node-title'), event.clientX, event.clientY);
  });
  return el;
}
function renderNodes() {
  nodeLayer.replaceChildren(...state.nodes.map(createNodeElement));
  updateNodeEmphasis();
}
function updateOneNode(id) {
  const n = getNode(id), el = [...nodeLayer.children].find(child => child.dataset.id === id);
  if (!n || !el) return;
  el.className = nodeLines(n.name).length > 1 ? 'node multiline' : 'node';
  n.x = Math.max(0, Math.min(BOARD_WIDTH - nodeWidth(n.name), n.x));
  n.y = Math.max(0, Math.min(BOARD_HEIGHT - nodeHeight(n.name), n.y));
  el.style.left = `${n.x}px`;
  el.style.top = `${n.y}px`;
  el.style.width = `${nodeWidth(n.name)}px`;
  el.style.height = `${nodeHeight(n.name)}px`;
  el.querySelector('.node-title').textContent = nodeText(n.name);
  el.querySelector('.node-description').textContent = n.description || 'メモを追加';
  updateNodeEmphasis();
}
function editorCharacterOffset(title) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !title.contains(selection.anchorNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(title);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return Array.from(range.toString().replace(/[\r\n]/g, '')).length;
}
function placeEditorCaret(title, name, characterOffset) {
  // 禁則で改行の位置が前後に動くので、途中までの文字列を折り返し直さず、全文の行から数える
  let offset = 0, left = characterOffset;
  for (const line of nodeLines(name)) {
    const chars = Array.from(line);
    if (left <= chars.length) { offset += chars.slice(0, left).join('').length; break; }
    offset += line.length + 1; left -= chars.length;
  }
  const range = document.createRange();
  range.setStart(title.firstChild || title, Math.min(offset, title.firstChild?.length || 0));
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
function placeEditorCaretAtPoint(title, x, y) {
  const position = document.caretPositionFromPoint?.(x, y);
  const hit = position?.offsetNode && title.contains(position.offsetNode)
    ? { node: position.offsetNode, offset: position.offset }
    : (() => {
        const range = document.caretRangeFromPoint?.(x, y);
        return range?.startContainer && title.contains(range.startContainer)
          ? { node: range.startContainer, offset: range.startOffset }
          : null;
      })();
  if (!hit) return false;
  const range = document.createRange();
  range.setStart(hit.node, hit.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
function beginNodeEdit(id, caretPoint = null) {
  const n = getNode(id), el = [...nodeLayer.children].find(child => child.dataset.id === id);
  if (!n || !el) return;
  if (selectedNodeIds.size) setNodeSelection([]);
  const title = el.querySelector('.node-title');
  if (title.contentEditable === 'true') return;
  const original = n.name;
  title.contentEditable = 'true';
  el.classList.add('editing');
  title.focus();
  if (!caretPoint || !placeEditorCaretAtPoint(title, caretPoint.x, caretPoint.y)) {
    const range = document.createRange();
    range.selectNodeContents(title); range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }
  const sync = event => {
    const composing = !!event?.isComposing;
    const caret = composing ? null : editorCharacterOffset(title);
    const clean = title.textContent.replace(/[\r\n]/g, '');
    n.name = clean;
    n.x = Math.max(0, Math.min(BOARD_WIDTH - nodeWidth(clean), n.x));
    n.y = Math.max(0, Math.min(BOARD_HEIGHT - nodeHeight(clean), n.y));
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    el.style.width = `${nodeWidth(clean)}px`;
    const heightChanged = el.style.height !== `${nodeHeight(clean)}px`;
    el.style.height = `${nodeHeight(clean)}px`;
    el.classList.toggle('multiline', nodeLines(clean).length > 1);
    if (heightChanged) followNodeGrowth(n.id, el);
    if (!composing) {
      const display = nodeText(clean);
      if (title.textContent !== display) {
        title.textContent = display;
        if (caret !== null) placeEditorCaret(title, clean, Math.min(caret, Array.from(clean).length));
      }
    }
    drawEdges();
    if (!composing) saveState();
  };
  const finish = () => {
    sync();
    title.contentEditable = 'false'; el.classList.remove('editing');
    title.removeEventListener('input', sync); title.removeEventListener('compositionend', sync); title.removeEventListener('blur', finish); title.removeEventListener('keydown', keydown);
  };
  const keydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); title.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); n.name = original; title.textContent = nodeText(original); title.blur(); }
  };
  title.addEventListener('input', sync);
  title.addEventListener('compositionend', sync);
  title.addEventListener('blur', finish);
  title.addEventListener('keydown', keydown);
}
function segmentCrossesRect(x1, y1, x2, y2, rect) {
  let first = 0, last = 1;
  for (const [start, delta, min, max] of [
    [x1, x2 - x1, rect.x - 6, rect.x + rect.width + 6],
    [y1, y2 - y1, rect.y - 6, rect.y + rect.height + 6]
  ]) {
    if (Math.abs(delta) < .001) {
      if (start < min || start > max) return false;
      continue;
    }
    const entry = (min - start) / delta, exit = (max - start) / delta;
    first = Math.max(first, Math.min(entry, exit));
    last = Math.min(last, Math.max(entry, exit));
    if (first > last) return false;
  }
  return true;
}
function positionForChild(parent, siblingCount) {
  const width = nodeWidth(''), height = NODE_HEIGHT;
  const parentWidth = nodeWidth(parent.name), parentHeight = nodeHeight(parent.name);
  const centerX = parent.x + parentWidth / 2, centerY = parent.y + parentHeight / 2;
  const occupied = state.nodes.map(node => ({ id: node.id, x: node.x, y: node.y, width: nodeWidth(node.name), height: nodeHeight(node.name) }));
  const side = siblingCount % 2 ? 1 : -1;
  const directions = [
    [1, 0], [.9, side * .65], [.9, -side * .65], [.65, side], [.65, -side],
    [0, side], [0, -side], [-.65, side], [-.65, -side], [-1, 0], [-.9, side * .65], [-.9, -side * .65]
  ];
  const evaluate = (x, y, preference) => {
    if (x < 32 || y < 32 || x + width > BOARD_WIDTH - 32 || y + height > BOARD_HEIGHT - 32) return null;
    let nearest = Infinity, crossings = 0;
    for (const rect of occupied) {
      if (x < rect.x + rect.width + 28 && x + width > rect.x - 28 && y < rect.y + rect.height + 28 && y + height > rect.y - 28) return null;
      const gapX = Math.max(0, rect.x - x - width, x - rect.x - rect.width);
      const gapY = Math.max(0, rect.y - y - height, y - rect.y - rect.height);
      nearest = Math.min(nearest, Math.hypot(gapX, gapY));
      if (rect.id !== parent.id && segmentCrossesRect(centerX, centerY, x + width / 2, y + height / 2, rect)) crossings += 1;
    }
    const screenLeft = x * transform.scale + transform.x;
    const screenTop = y * transform.scale + transform.y;
    const screenRight = (x + width) * transform.scale + transform.x;
    const screenBottom = (y + height) * transform.scale + transform.y;
    const outOfView = Math.max(0, -screenLeft) + Math.max(0, screenRight - canvas.clientWidth) +
      Math.max(0, -screenTop) + Math.max(0, screenBottom - canvas.clientHeight);
    return { x, y, score: preference + crossings * 220 + outOfView * .25 + Math.max(0, 80 - nearest) * .15 };
  };
  let best = null;
  for (let ring = 0; ring < 12; ring += 1) {
    const reachX = parentWidth / 2 + width / 2 + 90 + ring * 70;
    const reachY = parentHeight / 2 + height / 2 + 90 + ring * 70;
    directions.forEach(([dx, dy], rank) => {
      const x = Math.round(centerX + dx * reachX - width / 2);
      const y = Math.round(centerY + dy * reachY - height / 2);
      const candidate = evaluate(x, y, ring * 65 + rank * 12);
      if (candidate && (!best || candidate.score < best.score)) best = candidate;
    });
  }
  if (best) return best;
  for (let y = 32; y <= BOARD_HEIGHT - height - 32; y += height + 40) {
    for (let x = 32; x <= BOARD_WIDTH - width - 32; x += width + 40) {
      const candidate = evaluate(x, y, Math.hypot(x + width / 2 - centerX, y + height / 2 - centerY));
      if (candidate && (!best || candidate.score < best.score)) best = candidate;
    }
  }
  return best || { x: Math.max(0, Math.min(BOARD_WIDTH - width, parent.x + parentWidth + 90)), y: Math.max(0, Math.min(BOARD_HEIGHT - height, parent.y)) };
}
function addChildNode(parentId, at = null) {
  const parent = getNode(parentId); if (!parent) return;
  if (selectedNodeIds.size) setNodeSelection([]);
  let x, y;
  if (at) {
    const point = screenToWorld(at.clientX, at.clientY);
    x = Math.max(0, Math.min(BOARD_WIDTH - nodeWidth(''), point.x - nodeWidth('') / 2));
    y = Math.max(0, Math.min(BOARD_HEIGHT - NODE_HEIGHT, point.y - NODE_HEIGHT / 2));
  } else {
    const siblings = state.edges.filter(edge => edge.from === parentId).length;
    ({ x, y } = positionForChild(parent, siblings));
  }
  const node = { id: uid('node'), name: '', description: '', x, y };
  const edge = { id: uid('edge'), from: parentId, to: node.id, type: 'cause', label: '' };
  state.nodes.push(node); state.edges.push(edge);
  nodeLayer.appendChild(createNodeElement(node));
  drawEdges(); animateSplit(parent, node, edge); updateCounts(); saveState();
}
function animateSplit(parent, child, edge) {
  const parentEl = [...nodeLayer.children].find(element => element.dataset.id === parent.id);
  const childEl = [...nodeLayer.children].find(element => element.dataset.id === child.id);
  if (!parentEl || !childEl) { beginNodeEdit(child.id); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { beginNodeEdit(child.id); return; }
  const edgeGroup = [...edgeLayer.children].find(group => group.dataset.id === edge.id);
  const edgePath = edgeGroup?.querySelector('.edge-path');
  const edgeHit = edgeGroup?.querySelector('.edge-hit');
  const updateMotion = progress => {
    const parentCenterX = parent.x + nodeWidth(parent.name) / 2;
    const parentCenterY = parent.y + nodeHeight(parent.name) / 2;
    const childCenterX = child.x + nodeWidth(child.name) / 2;
    const childCenterY = child.y + nodeHeight(child.name) / 2;
    const dx = (parentCenterX - childCenterX) * (1 - progress);
    const dy = (parentCenterY - childCenterY) * (1 - progress);
    childEl.style.transform = `translate(${dx}px, ${dy}px)`;
    const geometry = edgeGeometry(edge, { nodes: [parent, { ...child, x: child.x + dx, y: child.y + dy }] });
    if (geometry) {
      edgePath?.setAttribute('d', geometry.path);
      edgeHit?.setAttribute('d', geometry.path);
    }
  };
  parentEl.classList.add('splitting');
  childEl.classList.add('birth');
  updateMotion(0);
  const startedAt = performance.now();
  const tick = now => {
    if (!childEl.isConnected || !state.nodes.includes(child)) return;
    const progress = Math.min(1, (now - startedAt) / 620);
    updateMotion(1 - (1 - progress) ** 3);
    if (progress < 1) { requestAnimationFrame(tick); return; }
    parentEl.classList.remove('splitting');
    childEl.classList.remove('birth');
    childEl.style.removeProperty('transform');
    beginNodeEdit(child.id);
  };
  requestAnimationFrame(tick);
}
function edgeGeometry(edge, boardState = state) {
  const a = boardState.nodes.find(node => node.id === edge.from), b = boardState.nodes.find(node => node.id === edge.to);
  if (!a || !b) return null;
  const aw = nodeWidth(a.name), bw = nodeWidth(b.name);
  const liveHeight = node => (boardState === state && growingNodeHeights.get(node.id)) || nodeHeight(node.name);
  const ah = liveHeight(a), bh = liveHeight(b);
  const ax = a.x + aw / 2, ay = a.y + ah / 2, bx = b.x + bw / 2, by = b.y + bh / 2;
  const anchor = (cx, cy, rx, ry, tx, ty) => {
    const dx = tx - cx, dy = ty - cy;
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) || 1);
    const x = cx + dx * scale, y = cy + dy * scale;
    let nx = (x - cx) / (rx * rx), ny = (y - cy) / (ry * ry);
    const length = Math.hypot(nx, ny) || 1;
    nx /= length; ny /= length;
    return { x, y, nx, ny };
  };
  const start = anchor(ax, ay, aw / 2, ah / 2, bx, by);
  const end = anchor(bx, by, bw / 2, bh / 2, ax, ay);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const curve = Math.min(150, Math.max(28, distance * .34));
  const c1x = start.x + start.nx * curve, c1y = start.y + start.ny * curve;
  const c2x = end.x + end.nx * curve, c2y = end.y + end.ny * curve;
  return {
    path: `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`,
    start, end, c1x, c1y, c2x, c2y,
    lx: (start.x + end.x) / 2,
    ly: (start.y + end.y) / 2 - 8
  };
}
// 行が増減してカプセルの高さが CSS で伸び縮みしている間、線も途中の高さに合わせて引き直す
function followNodeGrowth(id, el) {
  const until = performance.now() + 320;
  cancelAnimationFrame(nodeGrowthFrame);
  growingNodeHeights.set(id, el.offsetHeight);
  const step = now => {
    if (now < until && el.isConnected) {
      growingNodeHeights.set(id, el.offsetHeight);
      drawEdges();
      nodeGrowthFrame = requestAnimationFrame(step);
    } else {
      growingNodeHeights.clear();
      drawEdges();
    }
  };
  nodeGrowthFrame = requestAnimationFrame(step);
}
function drawEdges() {
  $('edgeDefs').replaceChildren();
  const existing = new Map([...edgeLayer.children].map(group => [group.dataset.id, group]));
  const active = new Set();
  for (const edge of state.edges) {
    const geo = edgeGeometry(edge); if (!geo) continue;
    active.add(edge.id);
    let group = existing.get(edge.id);
    if (!group) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'edge-group'); group.dataset.id = edge.id;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('class', 'edge-path');
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path'); hit.setAttribute('class', 'edge-hit');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text'); label.setAttribute('class', 'edge-text'); label.setAttribute('text-anchor', 'middle');
      hit.addEventListener('pointerdown', event => {
        event.stopPropagation();
        if (event.shiftKey && !connectMode) beginShiftCut(event, () => selectItem('edge', edge.id));
        else selectItem('edge', edge.id);
      });
      group.append(path, hit, label); edgeLayer.appendChild(group);
    }
    const path = group.querySelector('.edge-path'), hit = group.querySelector('.edge-hit'), label = group.querySelector('.edge-text');
    path.setAttribute('d', geo.path); path.setAttribute('stroke', RELATIONS[edge.type].color);
    path.removeAttribute('stroke-dasharray');
    hit.setAttribute('d', geo.path);
    label.setAttribute('x', geo.lx); label.setAttribute('y', geo.ly); label.textContent = edge.label || RELATIONS[edge.type].label;
  }
  existing.forEach((group, id) => { if (!active.has(id)) group.remove(); });
  updateNodeEmphasis();
}
function updateNodeEmphasis() {
  const related = new Set();
  if (selected?.kind === 'node') {
    related.add(selected.id);
    state.edges.forEach(e => { if (e.from === selected.id) related.add(e.to); if (e.to === selected.id) related.add(e.from); });
  }
  for (const el of nodeLayer.children) {
    const id = el.dataset.id;
    const node = getNode(id);
    if (!node) continue;
    const matches = !searchTerm || (node.name + ' ' + (node.description || '')).toLocaleLowerCase().includes(searchTerm);
    el.classList.toggle('selected', selected?.kind === 'node' && selected.id === id);
    el.classList.toggle('multi-selected', selectedNodeIds.has(id));
    el.classList.toggle('dim', selectedNodeIds.size === 0 && selected?.kind === 'node' && !selected.quiet && !related.has(id));
    el.classList.toggle('search-match', !!searchTerm && matches);
    el.classList.toggle('search-dim', !!searchTerm && !matches);
  }
  for (const el of edgeLayer.children) {
    const edge = getEdge(el.dataset.id);
    el.classList.toggle('selected', selected?.kind === 'edge' && selected.id === edge?.id);
    el.classList.toggle('dim', selectedNodeIds.size === 0 && selected?.kind === 'node' && !selected.quiet && edge?.from !== selected.id && edge?.to !== selected.id);
  }
}

function setNodeSelection(ids) {
  const next = new Set(ids);
  if (linkStartId && !next.has(linkStartId)) linkStartId = null;
  if (!selected && next.size === selectedNodeIds.size && [...next].every(id => selectedNodeIds.has(id))) return;
  selectedNodeIds = next;
  selected = null;
  updateNodeEmphasis();
  renderInspector();
  $('inspector').classList.remove('mobile-open');
}

function toggleNodeSelection(id) {
  const next = new Set(selectedNodeIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setNodeSelection(next);
}

function selectItem(kind, id, { quiet = false } = {}) {
  if (id) { selectedNodeIds.clear(); linkStartId = null; }
  selected = id ? { kind, id, quiet } : null;
  updateNodeEmphasis(); renderInspector();
  $('inspector').classList.toggle('mobile-open', !!selected);
}
function renderInspector() {
  const root = $('inspectorContent');
  if (!selected) {
    root.innerHTML = `<div class="inspector-kicker">DETAILS</div><div class="inspector-empty"><div class="empty-illustration"><span></span><span></span><span></span></div><h2>つながりを見つけよう</h2><p>キャンバスの単語や関係線を選ぶと、ここに詳細が表示されます。</p><button type="button" id="inspectorAdd">＋ 単語を追加する</button></div>`;
    $('inspectorAdd').addEventListener('click', addRootNodeInCenter); return;
  }
  if (selected.kind === 'node') {
    const n = getNode(selected.id); if (!n) { selectItem(null, null); return; }
    const linked = state.edges.filter(e => e.from === n.id || e.to === n.id);
    const relHtml = linked.length ? linked.map(e => {
      const other = getNode(e.from === n.id ? e.to : e.from);
      return `<div class="relation-row"><i class="relation-line" style="background:${RELATIONS[e.type].color}"></i><span><strong>${esc(other?.name || '')}</strong><br><span class="relation-direction">${e.from === n.id ? '→' : '←'} ${esc(e.label || RELATIONS[e.type].label)}</span></span></div>`;
    }).join('') : '<div class="inspector-meta">まだ関係はありません。</div>';
    root.innerHTML = `<div class="inspector-kicker">WORD DETAILS</div><div class="inspector-title-row"><h2>${esc(n.name)}</h2><button type="button" id="closeInspector" aria-label="閉じる">×</button></div><div class="inspector-section"><div class="field-group"><label class="field-label" for="editName">単語・アイデア</label><input class="field-input" id="editName" value="${esc(n.name)}"></div><div class="field-group"><label class="field-label" for="editDescription">メモ</label><textarea class="field-textarea" id="editDescription" maxlength="800" placeholder="設定の詳細を書き留める">${esc(n.description || '')}</textarea></div></div><div class="inspector-section"><div class="field-label">つながり <span>(${linked.length})</span></div>${relHtml}<div class="inspector-action"><button type="button" id="connectThis">＋ この単語からつなぐ</button></div></div><div class="inspector-section"><button class="delete-button" type="button" id="deleteNode">この単語を削除</button><p class="field-hint">接続している関係も一緒に削除されます。</p></div>`;
    $('closeInspector').addEventListener('click', () => selectItem(null, null));
    $('editName').addEventListener('input', e => { n.name = e.target.value; root.querySelector('h2').textContent = n.name || '無題の単語'; updateOneNode(n.id); drawEdges(); saveState(); });
    $('editDescription').addEventListener('input', e => { n.description = e.target.value; updateOneNode(n.id); saveState(); });
    $('connectThis').addEventListener('click', () => startConnect(n.id));
    $('deleteNode').addEventListener('click', () => discardNodes([n.id]));
  } else {
    const e = getEdge(selected.id); if (!e) { selectItem(null, null); return; }
    root.innerHTML = `<div class="inspector-kicker">RELATION DETAILS</div><div class="inspector-title-row"><h2>関係を編集</h2><button type="button" id="closeInspector" aria-label="閉じる">×</button></div><div class="inspector-section"><div class="field-group"><label class="field-label" for="editEdgeFrom">原因・出発点</label><select class="field-select" id="editEdgeFrom">${nodeOptions(e.from)}</select></div><div class="field-group"><label class="field-label" for="editEdgeTo">結果・到着点</label><select class="field-select" id="editEdgeTo">${nodeOptions(e.to)}</select></div><div class="field-group"><label class="field-label" for="editEdgeType">関係の種類</label><select class="field-select" id="editEdgeType">${Object.entries(RELATIONS).map(([key, value]) => `<option value="${key}" ${key === e.type ? 'selected' : ''}>${value.label}</option>`).join('')}</select><div class="edge-type-preview"><i style="--preview:${RELATIONS[e.type].color}"></i>線の色で関係を区別します</div></div><div class="field-group"><label class="field-label" for="editEdgeLabel">線に表示する言葉</label><input class="field-input" id="editEdgeLabel" maxlength="70" value="${esc(e.label)}" placeholder="例：秘密が霧を生む"></div></div><div class="inspector-section"><button class="delete-button" type="button" id="deleteEdge">この関係を削除</button></div>`;
    $('closeInspector').addEventListener('click', () => selectItem(null, null));
    const changeEnd = (key, input) => input.addEventListener('change', event => { if (event.target.value === e[key === 'from' ? 'to' : 'from']) { toast('同じ単語同士はつなげません'); event.target.value = e[key]; return; } e[key] = event.target.value; drawEdges(); saveState(); });
    changeEnd('from', $('editEdgeFrom')); changeEnd('to', $('editEdgeTo'));
    $('editEdgeType').addEventListener('change', event => { e.type = event.target.value; renderInspector(); drawEdges(); saveState(); });
    $('editEdgeLabel').addEventListener('input', event => { e.label = event.target.value; drawEdges(); saveState(); });
    $('deleteEdge').addEventListener('click', () => { state.edges = state.edges.filter(x => x.id !== e.id); selectItem(null, null); drawEdges(); updateCounts(); saveState(); });
  }
}
function nodeOptions(value) { return state.nodes.map(n => `<option value="${esc(n.id)}" ${n.id === value ? 'selected' : ''}>${esc(n.name)}</option>`).join(''); }
function renderAll() { updateTitle(); renderNodes(); drawEdges(); updateCounts(); renderInspector(); applyTheme(); }

function boardDisplayName(board) {
  const title = board.state.title.trim();
  const firstWord = board.state.nodes.find(node => node.name.trim())?.name.trim();
  return title || firstWord || '無題のボード';
}
function revealHistoryActions(id, side = null) {
  revealedHistoryBoardId = id;
  revealedHistorySide = side;
  for (const shell of $('boardHistoryList').children) {
    const revealed = shell.dataset.boardId === id;
    shell.classList.toggle('reveal-delete', revealed && side === 'delete');
    shell.classList.toggle('reveal-tools', revealed && side === 'tools');
    for (const action of shell.querySelectorAll('.history-delete,.history-folder,.history-pin')) {
      const visible = revealed && action.classList.contains(side === 'delete' ? 'history-delete' : 'history-tool');
      action.tabIndex = visible ? 0 : -1;
      action.setAttribute('aria-hidden', String(!visible));
    }
  }
}
function renderBoardHistory() {
  const list = $('boardHistoryList');
  if (list.querySelector('.history-board-title[contenteditable="true"],.history-board-shell.deleting')) return;
  list.replaceChildren();
  const dateFormat = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const boardTime = board => Number.isFinite(board.updatedAt) ? board.updatedAt : Number.isFinite(board.createdAt) ? board.createdAt : 0;
  const boards = [...workspace.boards].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || boardTime(b) - boardTime(a));
  for (const board of boards) {
    const shell = document.createElement('div');
    shell.className = 'history-board-shell';
    shell.dataset.boardId = board.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-board';
    button.dataset.boardId = board.id;
    button.classList.toggle('active', board.id === workspace.activeBoardId);
    if (board.id === workspace.activeBoardId) button.setAttribute('aria-current', 'page');
    const title = document.createElement('span');
    title.className = 'history-board-title';
    title.textContent = boardDisplayName(board);
    const date = document.createElement('span');
    date.className = 'history-board-date';
    date.textContent = dateFormat.format(new Date(boardTime(board) || Date.now()));
    button.append(title, date);
    if (board.pinned) {
      const mark = document.createElement('span');
      mark.className = 'history-pin-mark';
      mark.setAttribute('aria-label', 'ピン留め中');
      mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 3 6 6-3.5.7-2 2-1 4-2 2-2-5-5-2 2-2 4-1 2-2z"/><path d="m9 15-6 6"/></svg>';
      button.append(mark);
    }
    button.addEventListener('click', () => {
      if (revealedHistoryBoardId === board.id) { revealHistoryActions(null); return; }
      switchBoard(board.id);
    });
    title.addEventListener('click', event => { if (title.isContentEditable) event.stopPropagation(); });
    title.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); beginHistoryTitleEdit(board.id); });
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'history-delete';
    deleteButton.textContent = '×';
    deleteButton.setAttribute('aria-label', `${boardDisplayName(board)}を削除`);
    deleteButton.addEventListener('click', event => { event.stopPropagation(); animateDeleteBoard(board.id, shell); });
    const folderButton = document.createElement('button');
    folderButton.type = 'button';
    folderButton.className = 'history-tool history-folder';
    folderButton.setAttribute('aria-label', `${boardDisplayName(board)}を書き出すフォルダを選ぶ`);
    folderButton.title = 'フォルダを選んでPNGを書き出す';
    folderButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M3 10h18"/></svg>';
    folderButton.addEventListener('click', event => { event.stopPropagation(); exportBoardToFolder(board); });
    const pinButton = document.createElement('button');
    pinButton.type = 'button';
    pinButton.className = 'history-tool history-pin';
    pinButton.classList.toggle('is-pinned', !!board.pinned);
    pinButton.setAttribute('aria-label', `${boardDisplayName(board)}のピン留めを${board.pinned ? '解除' : 'する'}`);
    pinButton.setAttribute('aria-pressed', String(!!board.pinned));
    pinButton.title = board.pinned ? 'ピン留めを解除' : 'ピン留め';
    pinButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 3 6 6-3.5.7-2 2-1 4-2 2-2-5-5-2 2-2 4-1 2-2z"/><path d="m9 15-6 6"/></svg>';
    pinButton.addEventListener('click', event => {
      event.stopPropagation();
      board.pinned = !board.pinned;
      persistWorkspace();
      renderBoardHistory();
      revealHistoryActions(board.id, 'tools');
    });
    shell.append(folderButton, pinButton, deleteButton, button);
    let swipeDistance = 0, lastSwipeAt = 0, lastDelta = 0, peakDelta = 0;
    let swipeCommitted = false, committedDirection = 0, tailSeen = false;
    shell.addEventListener('wheel', event => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? shell.clientWidth : 1;
      const dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (Math.abs(dx) < 1 || Math.abs(dx) <= Math.abs(dy)) return;
      event.preventDefault();
      const now = performance.now();
      const magnitude = Math.abs(dx);
      const newSwipe = now - lastSwipeAt > 100 ||
        (swipeCommitted && Math.sign(dx) !== committedDirection && magnitude >= 8) ||
        (swipeCommitted && now - lastSwipeAt > 38 && magnitude >= Math.max(14, peakDelta * .65)) ||
        (swipeCommitted && tailSeen && magnitude >= 10 && magnitude > lastDelta * 1.5);
      if (newSwipe) {
        swipeDistance = 0;
        swipeCommitted = false;
        peakDelta = 0;
        tailSeen = false;
      }
      if (swipeCommitted) {
        if (magnitude <= Math.max(5, peakDelta * .4)) tailSeen = true;
        // Tiny momentum events do not keep the previous swipe locked.
        if (magnitude > 5) lastSwipeAt = now;
        lastDelta = magnitude;
        return;
      }
      lastSwipeAt = now;
      lastDelta = magnitude;
      peakDelta = Math.max(peakDelta, magnitude);
      if (swipeDistance && Math.sign(dx) !== Math.sign(swipeDistance)) swipeDistance = 0;
      swipeDistance += dx;
      if (Math.abs(swipeDistance) < 42) return;
      committedDirection = Math.sign(swipeDistance);
      const direction = committedDirection > 0 ? 'delete' : 'tools';
      const currentSide = revealedHistoryBoardId === board.id ? revealedHistorySide : null;
      if (currentSide && currentSide !== direction) revealHistoryActions(null);
      else if (!currentSide) revealHistoryActions(board.id, direction);
      swipeDistance = 0;
      swipeCommitted = true;
    }, { passive: false });
    list.appendChild(shell);
  }
  revealHistoryActions(revealedHistoryBoardId, revealedHistorySide);
}
function beginHistoryTitleEdit(id) {
  const board = workspace.boards.find(item => item.id === id);
  const row = [...$('boardHistoryList').children].find(item => item.dataset.boardId === id);
  const title = row?.querySelector('.history-board-title');
  if (!board || !title || title.isContentEditable) return;
  const original = board.state.title;
  const shown = boardDisplayName(board);
  let cancelled = false;
  title.contentEditable = 'true';
  title.textContent = original || shown;
  title.focus();
  const range = document.createRange();
  range.selectNodeContents(title);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const finish = () => {
    title.removeEventListener('blur', finish);
    title.removeEventListener('keydown', onKeydown);
    const entered = title.textContent.replace(/[\r\n]/g, '').trim().slice(0, 80);
    title.contentEditable = 'false';
    const nextTitle = cancelled ? original : (!original && entered === shown ? '' : entered);
    if (nextTitle !== original) {
      board.state.title = nextTitle;
      board.updatedAt = Date.now();
      if (board.id === workspace.activeBoardId) { updateTitle(); saveState(); }
      else { persistWorkspace(); renderBoardHistory(); }
    }
    title.textContent = boardDisplayName(board);
  };
  const onKeydown = event => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); title.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelled = true; title.blur(); }
  };
  title.addEventListener('blur', finish);
  title.addEventListener('keydown', onKeydown);
}
function updateHistoryActiveRow() {
  const rows = [...$('boardHistoryList').querySelectorAll('.history-board')];
  if (!rows.some(row => row.dataset.boardId === workspace.activeBoardId)) { renderBoardHistory(); return; }
  for (const row of rows) {
    const active = row.dataset.boardId === workspace.activeBoardId;
    row.classList.toggle('active', active);
    if (active) row.setAttribute('aria-current', 'page');
    else row.removeAttribute('aria-current');
  }
}
function setHistoryOpen(open) {
  $('historyPanel').classList.toggle('open', open);
  $('historyPanel').setAttribute('aria-hidden', String(!open));
  $('historyToggle').setAttribute('aria-expanded', String(open));
  $('historyToggle').setAttribute('aria-label', open ? 'ボード履歴を閉じる' : 'ボード履歴を開く');
  if (open) renderBoardHistory();
  else {
    setSettingsOpen(false);
    revealedHistoryBoardId = null;
    revealedHistorySide = null;
    if ($('historyPanel').contains(document.activeElement) || $('settingsMenu').contains(document.activeElement)) $('historyToggle').focus();
  }
}
function switchBoard(id) {
  const next = workspace.boards.find(board => board.id === id);
  if (!next) return;
  if (id === workspace.activeBoardId) return;
  activeBoard().state = state;
  activeBoard().view = { ...transform };
  clearTimeout(saveTimer);
  clearTimeout(viewSaveTimer);
  persistWorkspace();
  workspace.activeBoardId = id;
  next.updatedAt = Date.now();
  state = next.state;
  selected = null;
  selectedNodeIds.clear();
  linkStartId = null;
  stopConnect();
  stopZoomMotion();
  stopPanMotion();
  searchTerm = '';
  $('searchInput').value = '';
  renderAll();
  const view = next.view;
  if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale) && view.scale >= .25 && view.scale <= 2.2) {
    transform = { x: view.x, y: view.y, scale: view.scale };
    transformWorld();
  } else fitView();
  updateHistoryActiveRow();
  persistWorkspace();
}
function createBoard() {
  if (workspace.boards.length >= 200) { toast('ボードの上限に達しました'); return; }
  const now = Date.now();
  const id = uid('board');
  workspace.boards.push({ id, state: clone(SEED), createdAt: now, updatedAt: now, view: null });
  switchBoard(id);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const shell = [...$('boardHistoryList').children].find(row => row.dataset.boardId === id);
  if (!shell) return;
  shell.scrollIntoView({ block: 'nearest' });
  shell.style.setProperty('--insert-height', `${shell.offsetHeight}px`);
  shell.classList.add('creating');
  shell.addEventListener('animationend', () => shell.classList.remove('creating'), { once: true });
}
function deleteBoard(id, deferRender = false) {
  if (!workspace.boards.some(board => board.id === id)) return;
  revealedHistoryBoardId = null;
  revealedHistorySide = null;
  if (workspace.activeBoardId === id) {
    let replacement = workspace.boards.find(board => board.id !== id);
    if (!replacement) {
      const now = Date.now();
      replacement = { id: uid('board'), state: clone(SEED), createdAt: now, updatedAt: now, view: null };
      workspace.boards.push(replacement);
    }
    switchBoard(replacement.id);
  }
  workspace.boards = workspace.boards.filter(board => board.id !== id);
  if (!deferRender) renderBoardHistory();
  persistWorkspace();
}

function animateDeleteBoard(id, shell) {
  if (shell.classList.contains('deleting')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { deleteBoard(id); return; }
  shell.style.setProperty('--delete-height', `${shell.offsetHeight}px`);
  shell.classList.add('deleting');
  deleteBoard(id, true);
  setTimeout(() => {
    shell.classList.remove('deleting');
    renderBoardHistory();
  }, 420);
}

function discardNodes(ids) {
  const removing = new Set(ids);
  if (!removing.size) return;
  const elements = [...nodeLayer.children].filter(element => removing.has(element.dataset.id));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    for (const element of elements) {
      element.classList.add('deleting');
      element.setAttribute('aria-hidden', 'true');
    }
  }
  state.nodes = state.nodes.filter(node => !removing.has(node.id));
  state.edges = state.edges.filter(edge => !removing.has(edge.from) && !removing.has(edge.to));
  selected = null;
  selectedNodeIds.clear();
  linkStartId = null;
  if (reducedMotion) renderNodes();
  drawEdges(); updateCounts(); renderInspector(); saveState(); persistWorkspace();
  if (!reducedMotion) setTimeout(() => elements.forEach(element => element.remove()), 260);
}

function segmentsCross(a, b, c, d) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function crossedEdgeId(from, to) {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 2) return null;
  for (const edge of state.edges) {
    const geo = edgeGeometry(edge);
    if (!geo) continue;
    if (Math.max(from.x, to.x) < Math.min(geo.start.x, geo.c1x, geo.c2x, geo.end.x) ||
        Math.min(from.x, to.x) > Math.max(geo.start.x, geo.c1x, geo.c2x, geo.end.x) ||
        Math.max(from.y, to.y) < Math.min(geo.start.y, geo.c1y, geo.c2y, geo.end.y) ||
        Math.min(from.y, to.y) > Math.max(geo.start.y, geo.c1y, geo.c2y, geo.end.y)) continue;
    let previousPoint = geo.start;
    for (let step = 1; step <= 64; step += 1) {
      const t = step / 64, u = 1 - t;
      const point = {
        x: u * u * u * geo.start.x + 3 * u * u * t * geo.c1x + 3 * u * t * t * geo.c2x + t * t * t * geo.end.x,
        y: u * u * u * geo.start.y + 3 * u * u * t * geo.c1y + 3 * u * t * t * geo.c2y + t * t * t * geo.end.y
      };
      if (segmentsCross(from, to, previousPoint, point)) return edge.id;
      previousPoint = point;
    }
  }
  return null;
}

function beginShiftCut(event, onTap) {
  event.preventDefault();
  event.stopPropagation();
  const pointerId = event.pointerId;
  const start = { x: event.clientX, y: event.clientY };
  let previous = start;
  let armed = false;
  let cancelled = false;
  let cut = false;
  canvas.setPointerCapture(pointerId);
  const showLine = point => {
    const rect = canvas.getBoundingClientRect();
    cutLine.setAttribute('x1', start.x - rect.left);
    cutLine.setAttribute('y1', start.y - rect.top);
    cutLine.setAttribute('x2', point.x - rect.left);
    cutLine.setAttribute('y2', point.y - rect.top);
  };
  const timer = setTimeout(() => {
    if (cancelled) return;
    armed = true;
    showLine(start);
    cutOverlay.hidden = false;
    canvas.classList.add('cutting');
  }, 360);
  const move = e => {
    if (e.pointerId !== pointerId) return;
    const point = { x: e.clientX, y: e.clientY };
    if (!armed) {
      if (Math.hypot(point.x - start.x, point.y - start.y) > 5) { cancelled = true; clearTimeout(timer); }
      return;
    }
    showLine(point);
    if (!cut) {
      const id = crossedEdgeId(screenToWorld(previous.x, previous.y), screenToWorld(point.x, point.y));
      if (id) {
        state.edges = state.edges.filter(edge => edge.id !== id);
        if (selected?.kind === 'edge' && selected.id === id) selected = null;
        drawEdges(); updateCounts(); renderInspector(); saveState();
        cut = true;
      }
    }
    previous = point;
  };
  const finish = e => {
    if (e.pointerId !== pointerId) return;
    clearTimeout(timer);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    cutOverlay.hidden = true;
    canvas.classList.remove('cutting');
    if (e.type === 'pointerup' && !armed && !cancelled) onTap?.();
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

function onNodePointerDown(event) {
  if (event.target.closest('.node-title[contenteditable="true"]')) return;
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  event.stopPropagation(); event.preventDefault();
  const el = event.currentTarget, n = getNode(el.dataset.id);
  stopPanMotion();
  stopZoomMotion();
  lastNodePointerDown = { id: n.id, x: event.clientX, y: event.clientY, at: Date.now() };
  if (event.shiftKey && !connectMode) {
    beginShiftCut(event, () => {
      toggleNodeSelection(n.id);
      if (selectedNodeIds.size === 1) linkStartId = [...selectedNodeIds][0];
    });
    return;
  }
  if (event.detail > 1) {
    beginNodeEdit(n.id, { x: event.clientX, y: event.clientY });
    return;
  }
  el.setPointerCapture(event.pointerId);
  const start = { x: event.clientX, y: event.clientY, scale: transform.scale };
  const movingIds = selectedNodeIds.has(n.id) ? [...selectedNodeIds] : [n.id];
  const movingNodes = movingIds.map(getNode).filter(Boolean);
  const origins = new Map(movingNodes.map(node => [node.id, { x: node.x, y: node.y }]));
  const elements = new Map([...nodeLayer.children].filter(element => origins.has(element.dataset.id)).map(element => [element.dataset.id, element]));
  const minX = Math.min(...movingNodes.map(node => node.x));
  const minY = Math.min(...movingNodes.map(node => node.y));
  const maxX = Math.max(...movingNodes.map(node => node.x + nodeWidth(node.name)));
  const maxY = Math.max(...movingNodes.map(node => node.y + nodeHeight(node.name)));
  let moved = false;
  const move = e => {
    const screenDx = e.clientX - start.x, screenDy = e.clientY - start.y;
    const dx = screenDx / start.scale, dy = screenDy / start.scale;
    if (!moved && Math.hypot(screenDx, screenDy) > 3) {
      moved = true;
      if (!selectedNodeIds.has(n.id) && selectedNodeIds.size) setNodeSelection([]);
    }
    if (!moved || connectMode) return;
    const boundedX = Math.max(-minX, Math.min(BOARD_WIDTH - maxX, dx));
    const boundedY = Math.max(-minY, Math.min(BOARD_HEIGHT - maxY, dy));
    for (const node of movingNodes) {
      const origin = origins.get(node.id), element = elements.get(node.id);
      node.x = origin.x + boundedX;
      node.y = origin.y + boundedY;
      if (element) { element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; element.classList.add('dragging'); }
    }
    drawEdges();
  };
  const up = e => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    for (const element of elements.values()) element.classList.remove('dragging');
    if (moved && !connectMode) saveState();
    else if (!moved && e.type === 'pointerup') {
      nodeActivated(n.id);
    }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function nodeActivated(id) {
  if (connectMode) {
    if (!connectFrom) { connectFrom = id; $('connectMessage').textContent = 'つなぐ先の単語を選択してください'; selectItem('node', id); }
    else if (connectFrom === id) toast('別の単語を選択してください');
    else {
      const already = state.edges.find(e => e.from === connectFrom && e.to === id);
      if (already) { stopConnect(); selectItem('edge', already.id); toast('既存の関係を開きました'); return; }
      const edge = { id: uid('edge'), from: connectFrom, to: id, type: 'cause', label: '引き起こす' };
      state.edges.push(edge); stopConnect(); drawEdges(); updateCounts(); selectItem('edge', edge.id); saveState(); toast('関係を追加しました');
    }
  } else {
    if (linkStartId && selectedNodeIds.size === 1 && selectedNodeIds.has(linkStartId) && id !== linkStartId) {
      setNodeSelection([linkStartId, id]);
      return;
    }
    selectItem('node', id, { quiet: true });
    centerOnNode(id);
  }
}
function startConnect(from = null) {
  if (selectedNodeIds.size) setNodeSelection([]);
  connectMode = true; connectFrom = from;
  $('connectButton').classList.add('active'); $('connectBanner').hidden = false;
  $('connectMessage').textContent = from ? 'つなぐ先の単語を選択してください' : '最初の単語を選択してください';
  if (from) { selected = { kind: 'node', id: from }; updateNodeEmphasis(); }
  if (window.innerWidth <= 680) $('inspector').classList.remove('mobile-open');
}
function stopConnect() { connectMode = false; connectFrom = null; $('connectButton').classList.remove('active'); $('connectBanner').hidden = true; }
function addRootNodeAt(clientX, clientY) {
  if (selectedNodeIds.size) setNodeSelection([]);
  const point = screenToWorld(clientX, clientY);
  const node = {
    id: uid('node'),
    name: '',
    description: '',
    x: Math.max(0, Math.min(BOARD_WIDTH - nodeWidth(''), point.x - nodeWidth('') / 2)),
    y: Math.max(0, Math.min(BOARD_HEIGHT - NODE_HEIGHT, point.y - NODE_HEIGHT / 2))
  };
  state.nodes.push(node);
  nodeLayer.appendChild(createNodeElement(node));
  drawEdges(); updateCounts(); saveState();
  beginNodeEdit(node.id);
}
function addRootNodeInCenter() {
  const rect = canvas.getBoundingClientRect();
  addRootNodeAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function capsulePath(context, x, y, width, height) {
  // 行数によらず1行のときの両端の丸みを保つ（画面の .node の border-radius と同じ）
  const radius = NODE_HEIGHT / 2;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arcTo(x + width, y, x + width, y + radius, radius);
  context.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  context.lineTo(x + radius, y + height);
  context.arcTo(x, y + height, x, y + radius, radius);
  context.arcTo(x, y, x + radius, y, radius);
  context.closePath();
}

async function createPngBlob(boardState = state) {
  const isLight = boardState.theme === 'light';
  const geometries = boardState.edges.map(edge => edgeGeometry(edge, boardState)).filter(Boolean);
  const xs = [], ys = [];
  for (const node of boardState.nodes) {
    xs.push(node.x, node.x + nodeWidth(node.name));
    ys.push(node.y, node.y + nodeHeight(node.name));
  }
  for (const geometry of geometries) {
    xs.push(geometry.start.x, geometry.end.x, geometry.c1x, geometry.c2x);
    ys.push(geometry.start.y, geometry.end.y, geometry.c1y, geometry.c2y);
  }
  const padding = 80;
  const left = xs.length ? Math.min(...xs) - padding : 0;
  const top = ys.length ? Math.min(...ys) - padding : 0;
  const right = xs.length ? Math.max(...xs) + padding : 960;
  const bottom = ys.length ? Math.max(...ys) + padding : 600;
  const width = Math.max(320, right - left);
  const height = Math.max(240, bottom - top);
  const outputScale = Math.max(.5, Math.min(2, 6000 / width, 6000 / height));
  const output = document.createElement('canvas');
  output.width = Math.round(width * outputScale);
  output.height = Math.round(height * outputScale);
  const context = output.getContext('2d');
  context.scale(outputScale, outputScale);
  context.fillStyle = isLight ? '#f3f4f6' : '#111214';
  context.fillRect(0, 0, width, height);

  context.fillStyle = isLight ? 'rgba(92, 99, 111, .24)' : 'rgba(174, 178, 190, .24)';
  const dotStartX = Math.floor(left / 24) * 24;
  const dotStartY = Math.floor(top / 24) * 24;
  for (let x = dotStartX; x <= right; x += 24) {
    for (let y = dotStartY; y <= bottom; y += 24) {
      context.beginPath();
      context.arc(x - left, y - top, 1, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.strokeStyle = isLight ? '#505761' : '#fff';
  context.lineWidth = 1.5;
  context.globalAlpha = .82;
  context.setLineDash([]);
  for (const geometry of geometries) {
    context.beginPath();
    context.moveTo(geometry.start.x - left, geometry.start.y - top);
    context.bezierCurveTo(
      geometry.c1x - left, geometry.c1y - top,
      geometry.c2x - left, geometry.c2y - top,
      geometry.end.x - left, geometry.end.y - top
    );
    context.stroke();
  }

  context.globalAlpha = 1;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '500 14px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif';
  for (const node of boardState.nodes) {
    const x = node.x - left, y = node.y - top, width = nodeWidth(node.name), height = nodeHeight(node.name);
    capsulePath(context, x, y, width, height);
    context.fillStyle = isLight ? '#fff' : '#303133';
    context.fill();
    context.strokeStyle = isLight ? '#505761' : '#fff';
    context.lineWidth = 1;
    context.stroke();
    if (node.name) {
      context.fillStyle = isLight ? '#292d33' : '#e5e5e7';
      const lines = nodeLines(node.name);
      lines.forEach((line, index) => context.fillText(line, x + width / 2, y + height / 2 + (index - (lines.length - 1) / 2) * NODE_LINE_HEIGHT + .5, Math.max(1, width - 32)));
    }
  }

  return new Promise(resolve => output.toBlob(resolve, 'image/png'));
}

function pngFileName(name) {
  return `${(name || APP_NAME).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)}.png`;
}

function downloadPngBlob(blob, filename) {
  if (!blob) { toast('PNGを作成できませんでした'); return; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPng() {
  const blob = await createPngBlob(state);
  if (!blob) { toast('PNGを作成できませんでした'); return; }
  downloadPngBlob(blob, pngFileName(state.title));
  toast('PNGを書き出しました');
}

async function exportBoardToFolder(board) {
  const filename = pngFileName(boardDisplayName(board));
  try {
    if (typeof window.showDirectoryPicker === 'function') {
      const folder = await window.showDirectoryPicker({ mode: 'readwrite' });
      const blob = await createPngBlob(board.state);
      if (!blob) throw new Error('PNG creation failed');
      const stem = filename.slice(0, -4);
      let file;
      for (let number = 1; number <= 1000; number += 1) {
        const candidate = number === 1 ? filename : `${stem} (${number}).png`;
        try { await folder.getFileHandle(candidate); }
        catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
          file = await folder.getFileHandle(candidate, { create: true });
          break;
        }
      }
      if (!file) throw new Error('No available file name');
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      toast('選んだフォルダにPNGを書き出しました');
      return;
    }
    if (typeof window.showSaveFilePicker === 'function') {
      const file = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PNG画像', accept: { 'image/png': ['.png'] } }] });
      const blob = await createPngBlob(board.state);
      if (!blob) throw new Error('PNG creation failed');
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      toast('PNGを書き出しました');
      return;
    }
    const blob = await createPngBlob(board.state);
    if (!blob) throw new Error('PNG creation failed');
    downloadPngBlob(blob, filename);
    toast('保存先はブラウザのダウンロード設定で選んでください');
  } catch (error) {
    if (error?.name !== 'AbortError') toast('フォルダへの書き出しに失敗しました');
  }
}

function updateSelectionMarquee(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(rect.left, Math.min(rect.right, clientX));
  const y = Math.max(rect.top, Math.min(rect.bottom, clientY));
  const left = Math.min(gesture.x, x), right = Math.max(gesture.x, x);
  const top = Math.min(gesture.y, y), bottom = Math.max(gesture.y, y);
  selectionMarquee.style.left = `${left - rect.left}px`;
  selectionMarquee.style.top = `${top - rect.top}px`;
  selectionMarquee.style.width = `${right - left}px`;
  selectionMarquee.style.height = `${bottom - top}px`;
  const ids = [];
  if (right - left > 3 && bottom - top > 3) {
    for (const element of nodeLayer.children) {
      const nodeRect = element.getBoundingClientRect();
      if (nodeRect.right > left && nodeRect.left < right && nodeRect.bottom > top && nodeRect.top < bottom) ids.push(element.dataset.id);
    }
  }
  // 範囲に何も入っていなければ、白枠で選択中のカプセルはそのまま残す
  if (ids.length || selectedNodeIds.size || !selected?.quiet) setNodeSelection(ids);
}

document.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const now = Date.now();
  const sameBurst = clickBurst && now - clickBurst.at < 700 && Math.hypot(event.clientX - clickBurst.x, event.clientY - clickBurst.y) < 36;
  const onNode = !!event.target.closest('.node');
  clickBurst = {
    x: event.clientX,
    y: event.clientY,
    at: now,
    startedOnNode: sameBurst ? clickBurst.startedOnNode || onNode : onNode,
    // 1回目のクリックで選択が外れる前に、白枠で選択していたカプセルを覚えておく
    parentId: sameBurst ? clickBurst.parentId : (!connectMode && selected?.kind === 'node' ? selected.id : null)
  };
}, true);

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  if (event.target.closest('.node')) return;
  if (event.target.closest('.zoom-controls,.canvas-label,.canvas-hint,.connect-banner')) return;
  if (event.target.closest('.edge-group')) return;
  stopZoomMotion();
  stopPanMotion();
  if (event.shiftKey && !connectMode) { beginShiftCut(event); return; }
  canvas.setPointerCapture(event.pointerId);
  gesture = { x: event.clientX, y: event.clientY, moved: false };
  selectionMarquee.hidden = false;
  canvas.classList.add('selecting');
  updateSelectionMarquee(event.clientX, event.clientY);
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || threeFingerPan) return;
  if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3) gesture.moved = true;
  updateSelectionMarquee(event.clientX, event.clientY);
});
function endSelection(event) {
  if (!gesture) return;
  // 白枠で選択したカプセルは、別のカプセルを選ぶまでボードのクリックでは外さない
  if (!gesture.moved && event.type === 'pointerup' && !connectMode && !selected?.quiet) selectItem(null, null);
  gesture = null;
  selectionMarquee.hidden = true;
  canvas.classList.remove('selecting');
}
canvas.addEventListener('pointerup', endSelection); canvas.addEventListener('pointercancel', endSelection);
const touchCenter = touches => {
  let x = 0, y = 0;
  for (let index = 0; index < touches.length; index += 1) {
    x += touches[index].clientX;
    y += touches[index].clientY;
  }
  return { x: x / touches.length, y: y / touches.length };
};
canvas.addEventListener('touchstart', event => {
  if (event.touches.length !== 3) return;
  event.preventDefault();
  stopZoomMotion(); stopPanMotion();
  selectionMarquee.hidden = true;
  canvas.classList.remove('selecting');
  const center = touchCenter(event.touches);
  gesture = null;
  threeFingerPan = { x: center.x, y: center.y, panX: transform.x, panY: transform.y };
  canvas.classList.add('panning');
}, { passive: false });
canvas.addEventListener('touchmove', event => {
  if (!threeFingerPan || event.touches.length !== 3) return;
  event.preventDefault();
  const center = touchCenter(event.touches);
  transform.x = threeFingerPan.panX + center.x - threeFingerPan.x;
  transform.y = threeFingerPan.panY + center.y - threeFingerPan.y;
  transformWorld();
}, { passive: false });
canvas.addEventListener('touchend', event => {
  if (!threeFingerPan || event.touches.length === 3) return;
  threeFingerPan = null;
  canvas.classList.remove('panning');
}, { passive: false });
canvas.addEventListener('dblclick', event => {
  if (event.target.closest('.node,.edge-group,.connect-banner')) return;
  const nearRecentNode = lastNodePointerDown && Date.now() - lastNodePointerDown.at < 900 && Math.hypot(event.clientX - lastNodePointerDown.x, event.clientY - lastNodePointerDown.y) < 36;
  if (clickBurst?.startedOnNode || nearRecentNode) {
    stopPanMotion();
    if (nearRecentNode) beginNodeEdit(lastNodePointerDown.id, { x: event.clientX, y: event.clientY });
    return;
  }
  event.preventDefault();
  if (clickBurst?.parentId && getNode(clickBurst.parentId)) addChildNode(clickBurst.parentId, { clientX: event.clientX, clientY: event.clientY });
  else addRootNodeAt(event.clientX, event.clientY);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerType !== 'touch') zoomCursor = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
  if (!event.ctrlKey) {
    panByTrackpad(event.deltaX * unit, event.deltaY * unit);
    return;
  }
  const delta = Math.max(-40, Math.min(40, event.deltaY * unit));
  zoomAt(Math.exp(-delta * .0033), event.clientX, event.clientY);
}, { passive: false });
$('zoomIn').addEventListener('click', () => zoomAt(1.2, zoomCursor?.x, zoomCursor?.y));
$('zoomOut').addEventListener('click', () => zoomAt(1 / 1.2, zoomCursor?.x, zoomCursor?.y));
$('fitButton').addEventListener('click', fitView);
function setSettingsOpen(open, { focus = false } = {}) {
  $('settingsPanel').hidden = !open;
  $('settingsMenu').classList.toggle('open', open);
  $('historyPanel').classList.toggle('settings-open', open);
  $('settingsToggle').setAttribute('aria-expanded', String(open));
  $('settingsToggle').setAttribute('aria-label', open ? '設定を閉じる' : '設定を開く');
  if (open && focus) $('settingsHelp').focus();
}
const settingsMenu = $('settingsMenu');
settingsMenu.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse' || event.pointerType === 'pen') setSettingsOpen(true);
});
settingsMenu.addEventListener('pointerleave', event => {
  if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && $('helpModal').hidden) setSettingsOpen(false);
});
let settingsPointerType = null;
$('settingsToggle').addEventListener('pointerdown', event => { settingsPointerType = event.pointerType; });
$('settingsToggle').addEventListener('click', event => {
  const pointerType = event.detail === 0 ? 'keyboard' : settingsPointerType;
  settingsPointerType = null;
  if (pointerType === 'mouse' || pointerType === 'pen') return;
  setSettingsOpen($('settingsPanel').hidden, { focus: true });
});
function setTheme(theme) {
  if (state.theme === theme) return;
  state.theme = theme;
  applyTheme();
  saveState();
  persistWorkspace();
}
$('themeSwitch').addEventListener('change', event => setTheme(event.target.checked ? 'light' : 'dark'));
function setExportMenuOpen(open) {
  $('exportMenu').classList.toggle('open', open);
  const toggle = $('exportMenuToggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  toggle.title = open ? 'メニューを閉じる' : 'メニューを開く';
}
$('exportMenuToggle').addEventListener('click', () => setExportMenuOpen(!$('exportMenu').classList.contains('open')));$('pngExport').addEventListener('click', () => { setExportMenuOpen(false); exportPng(); });
function exportBoardJson() {
  const data = { formatVersion: BlackBoardData.FORMAT_VERSION, ...state };
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(state.title || APP_NAME).replace(/[\\/:*?"<>|]/g, '-')}.blackboard.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('AI編集用JSONを書き出しました');
}
$('jsonExport').addEventListener('click', () => { setExportMenuOpen(false); exportBoardJson(); });
$('jsonImport').addEventListener('click', () => { setExportMenuOpen(false); $('importFile').click(); });
$('historyToggle').addEventListener('click', event => {
  setHistoryOpen(!$('historyPanel').classList.contains('open'));
  if (event.detail > 0) event.currentTarget.blur();
});
$('newBoardButton').addEventListener('click', createBoard);
$('addNodeButton').addEventListener('click', addRootNodeInCenter);
$('connectButton').addEventListener('click', () => connectMode ? stopConnect() : startConnect());
$('cancelConnect').addEventListener('click', stopConnect);
$('boardTitle').addEventListener('input', event => { state.title = event.target.value; updateTitle(); saveState(); });
$('themeButton').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
$('searchInput').addEventListener('input', event => { searchTerm = event.target.value.trim().toLocaleLowerCase(); updateNodeEmphasis(); });
$('searchInput').addEventListener('keydown', event => { if (event.key !== 'Enter') return; const n = state.nodes.find(n => (n.name + ' ' + (n.description || '')).toLocaleLowerCase().includes(searchTerm)); if (n) { selectItem('node', n.id); centerOnNode(n.id); $('searchInput').blur(); } });
$('exportButton').addEventListener('click', exportBoardJson);
$('importButton').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { const parsed = JSON.parse(await file.text()); const errors = BlackBoardData.validateBoard(parsed); if (errors.length) throw new Error(errors[0]); state = parsed; selected = null; selectedNodeIds.clear(); linkStartId = null; stopConnect(); searchTerm = ''; $('searchInput').value = ''; renderAll(); fitView(); saveState(); toast('キャンバスを読み込みました'); }
  catch (error) { toast(`JSONを読み込めません: ${error.message}`); }
  event.target.value = '';
});
let helpOpenedFromSettings = false;
function openHelpModal(fromSettings = false) {
  helpOpenedFromSettings = fromSettings;
  $('helpModal').hidden = false;
  $('closeHelp').focus();
}
function closeHelpModal() {
  $('helpModal').hidden = true;
  if (helpOpenedFromSettings && !$('settingsPanel').hidden) $('settingsHelp').focus();
  helpOpenedFromSettings = false;
}
$('settingsHelp').addEventListener('click', () => openHelpModal(true));
$('showHelp').addEventListener('click', () => openHelpModal());
$('closeHelp').addEventListener('click', closeHelpModal);
$('helpDone').addEventListener('click', closeHelpModal);
$('helpModal').addEventListener('pointerdown', e => { if (e.target === $('helpModal')) closeHelpModal(); });
$('menuButton').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
$('boardItem').addEventListener('click', () => { document.querySelector('.sidebar').classList.remove('open'); fitView(); });
$('workspaceButton').addEventListener('click', () => toast('このキャンバスはブラウザ内に保存されます'));
document.addEventListener('pointerdown', event => {
  if (!$('helpModal').hidden && $('helpModal').contains(event.target)) return;
  const panel = $('historyPanel');
  if (panel.classList.contains('open') && !panel.contains(event.target) && !$('historyToggle').contains(event.target) && !$('settingsMenu').contains(event.target)) {
    setHistoryOpen(false);
  }
}, true);
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#exportMenu')) setExportMenuOpen(false);
});
document.addEventListener('pointerdown', event => {
  if (!$('helpModal').hidden && $('helpModal').contains(event.target)) return;
  if (!event.target.closest('#settingsMenu')) setSettingsOpen(false);
});
document.addEventListener('pointerdown', event => {
  const editor = document.querySelector('.node-title[contenteditable="true"]');
  if (!editor) return;
  const editingNode = editor.closest('.node');
  const touchedNode = event.target.closest('.node');
  if (touchedNode !== editingNode) editor.blur();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (!$('helpModal').hidden) { closeHelpModal(); return; } if (!$('settingsPanel').hidden) { setSettingsOpen(false); $('settingsToggle').focus(); return; } if ($('exportMenu').classList.contains('open')) { setExportMenuOpen(false); return; } if (connectMode) stopConnect(); else if (selectedNodeIds.size) setNodeSelection([]); else selectItem(null, null); document.querySelector('.sidebar').classList.remove('open'); }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchInput').focus(); }
  if (!typing && event.key === 'Enter' && linkStartId && selectedNodeIds.size === 2 && !document.activeElement?.closest('button')) {
    const to = [...selectedNodeIds].find(id => id !== linkStartId);
    if (to && getNode(linkStartId) && getNode(to)) {
      event.preventDefault();
      const exists = state.edges.some(edge => (edge.from === linkStartId && edge.to === to) || (edge.from === to && edge.to === linkStartId));
      if (!exists) {
        state.edges.push({ id: uid('edge'), from: linkStartId, to, type: 'cause', label: '' });
        drawEdges(); updateCounts(); saveState();
      }
      setNodeSelection([]);
    }
  }
  if (!typing && (event.key === 'n' || event.key === 'N')) { event.preventDefault(); addRootNodeInCenter(); }
  if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
    if (selectedNodeIds.size) { event.preventDefault(); discardNodes([...selectedNodeIds]); }
    else if (selected) { event.preventDefault(); if (selected.kind === 'node') $('deleteNode')?.click(); else $('deleteEdge')?.click(); }
  }
});

window.addEventListener('resize', () => { stopZoomMotion(); stopPanMotion(); transformWorld(); });

renderAll();
renderBoardHistory();
requestAnimationFrame(() => {
  const view = activeBoard().view;
  if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale) && view.scale >= .25 && view.scale <= 2.2) {
    transform = { x: view.x, y: view.y, scale: view.scale };
    transformWorld();
  } else fitView();
  persistWorkspace();
});
