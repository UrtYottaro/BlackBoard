/* The board file format shared by the browser and command-line tools. No DOM or storage access here. */
const BlackBoardData = (() => {
  'use strict';

  const FORMAT_VERSION = 1;
  const MAX_NODES = 500;
  const MAX_EDGES = 2000;
  const RELATIONS = Object.freeze({
    cause: { label: '引き起こす', color: '#68c8a8' },
    prevent: { label: '妨げる', color: '#ee9c82' },
    premise: { label: '前提になる', color: '#bba3f1' },
    relate: { label: '関連する', color: '#a6adbd' }
  });

  function createEmptyBoard(title = '') {
    return { formatVersion: FORMAT_VERSION, title, theme: 'dark', nodes: [], edges: [] };
  }

  function validateBoard(value) {
    const errors = [];
    const record = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    if (!record(value)) return ['Board must be a JSON object.'];
    if (value.formatVersion !== undefined && value.formatVersion !== FORMAT_VERSION) errors.push(`formatVersion must be ${FORMAT_VERSION}.`);
    if (typeof value.title !== 'string') errors.push('title must be a string.');
    if (value.theme !== undefined && !['dark', 'light'].includes(value.theme)) errors.push('theme must be dark or light.');
    if (!Array.isArray(value.nodes)) errors.push('nodes must be an array.');
    if (!Array.isArray(value.edges)) errors.push('edges must be an array.');
    if (errors.length) return errors;
    if (value.nodes.length > MAX_NODES) errors.push(`nodes cannot exceed ${MAX_NODES}.`);
    if (value.edges.length > MAX_EDGES) errors.push(`edges cannot exceed ${MAX_EDGES}.`);

    const nodeIds = new Set();
    value.nodes.forEach((node, index) => {
      const path = `nodes[${index}]`;
      if (!record(node)) { errors.push(`${path} must be an object.`); return; }
      if (typeof node.id !== 'string' || !node.id) errors.push(`${path}.id must be a nonempty string.`);
      else if (nodeIds.has(node.id)) errors.push(`${path}.id is duplicated: ${node.id}`);
      else nodeIds.add(node.id);
      if (typeof node.name !== 'string') errors.push(`${path}.name must be a string.`);
      if (node.description !== undefined && typeof node.description !== 'string') errors.push(`${path}.description must be a string.`);
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) errors.push(`${path}.x and .y must be finite numbers.`);
    });

    const edgeIds = new Set();
    value.edges.forEach((edge, index) => {
      const path = `edges[${index}]`;
      if (!record(edge)) { errors.push(`${path} must be an object.`); return; }
      if (typeof edge.id !== 'string' || !edge.id) errors.push(`${path}.id must be a nonempty string.`);
      else if (edgeIds.has(edge.id)) errors.push(`${path}.id is duplicated: ${edge.id}`);
      else edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from)) errors.push(`${path}.from does not name a node.`);
      if (!nodeIds.has(edge.to)) errors.push(`${path}.to does not name a node.`);
      if (edge.from === edge.to) errors.push(`${path} cannot connect a node to itself.`);
      if (!Object.hasOwn(RELATIONS, edge.type)) errors.push(`${path}.type is unknown.`);
      if (typeof edge.label !== 'string') errors.push(`${path}.label must be a string.`);
    });
    return errors;
  }

  return Object.freeze({ FORMAT_VERSION, MAX_NODES, MAX_EDGES, RELATIONS, createEmptyBoard, validateBoard,
    isValidBoard: value => validateBoard(value).length === 0 });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BlackBoardData;
