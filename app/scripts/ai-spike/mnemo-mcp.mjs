#!/usr/bin/env node
// Phase 0 spike — a dependency-free MCP (stdio, newline-delimited JSON-RPC) server that exposes
// MnemoScript's document tools to an AI agent CLI. This is the shape the real feature will use:
// the CLI's own file/shell tools are disabled and the model can only touch the story through these.
//
// Usage: node mnemo-mcp.mjs <projectDir> <mode: plan|ask|auto>
//   <projectDir>/documents/*.json   { id, title, docType, content }
//   <projectDir>/proposals.jsonl    every write the model asks for (ask mode)  — inspected by the spike runner
//   <projectDir>/applied.jsonl      every write applied directly (auto mode)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const projectDir = process.argv[2];
const mode = process.argv[3] ?? 'ask';
const docsDir = path.join(projectDir, 'documents');

const readDocs = () =>
  fs.readdirSync(docsDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(docsDir, f), 'utf8')));

const READ_TOOLS = [
  {
    name: 'list_documents',
    description: 'List the documents (chapters, notes, mind maps, fantasy maps) in the open MnemoScript project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_document',
    description: 'Read one document. Text documents return HTML; mind maps return {nodes, edges} JSON.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];
const WRITE_TOOLS = [
  {
    name: 'edit_text',
    description:
      'Replace an exact passage in a text document. `find` must match the current text exactly (plain text, no HTML). ' +
      'Depending on the session mode the edit is applied immediately or shown to the writer for approval.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'find', 'replace'],
    },
  },
  {
    name: 'add_mindmap_node',
    description: 'Add a node to a mind map, optionally linked to an existing node.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, label: { type: 'string' }, linkTo: { type: 'string' } },
      required: ['id', 'label'],
    },
  },
];
// Plan mode: write tools are simply not offered, so no provider can write — enforced here, not by the model.
const tools = mode === 'plan' ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];

const text = (t) => ({ content: [{ type: 'text', text: t }] });

function callTool(name, args) {
  const docs = readDocs();
  if (name === 'list_documents') {
    return text(JSON.stringify(docs.map(({ id, title, docType }) => ({ id, title, docType }))));
  }
  if (name === 'read_document') {
    const d = docs.find((x) => x.id === args.id);
    return d ? text(d.content) : { ...text(`No document with id ${args.id}`), isError: true };
  }
  if (!WRITE_TOOLS.some((t) => t.name === name) || mode === 'plan') {
    return { ...text(`Tool ${name} is not available in ${mode} mode.`), isError: true };
  }
  const record = JSON.stringify({ at: new Date().toISOString(), tool: name, args }) + '\n';
  if (mode === 'auto') {
    fs.appendFileSync(path.join(projectDir, 'applied.jsonl'), record);
    return text('Applied.');
  }
  fs.appendFileSync(path.join(projectDir, 'proposals.jsonl'), record);
  return text('Proposed. The writer will review this change before it is applied.');
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification (e.g. notifications/initialized)
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'mnemoscript', version: '0.0.1' },
    } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
  } else if (method === 'tools/call') {
    try { send({ jsonrpc: '2.0', id, result: callTool(params.name, params.arguments ?? {}) }); }
    catch (e) { send({ jsonrpc: '2.0', id, result: { ...text(String(e)), isError: true } }); }
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
