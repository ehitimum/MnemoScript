#!/usr/bin/env node
// Phase 0 spike runner — drives the user's own installed Claude Code CLI headlessly, exactly the way
// the MnemoScript desktop app would, and checks the five things Phase 0 must answer:
//   T1 lockdown   built-in tools disabled, only MnemoScript's MCP tools visible
//   T2 ask        the model edits a chapter through `edit_text` → change lands in proposals (not applied)
//   T3 plan       write tools are not offered; the model can only describe a plan
//   T4 handoff    a session started by another model (transcript replayed) is continued without refusal
//   T5 usage      which usage / rate-limit data the stream exposes (for the 5-hour / weekly bars)
//
// Usage:  node scripts/ai-spike/run-spike.mjs [T1 T2 ...]   (default: all)
// Writes a JSON report to scripts/ai-spike/out/report.json (gitignored) and prints a summary.
// Model calls use the CLI's own sign-in (run `claude auth login` once in a terminal). Cheap model on purpose.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const MODEL = process.env.SPIKE_MODEL ?? 'haiku';

// Only pass through what a normal desktop launch would have — never the parent's CLAUDE_* session vars.
const KEEP = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot',
  'TEMP', 'TMP', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'LANG'];
const cleanEnv = Object.fromEntries(KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

const CHAPTER = `<h1>Chapter 3 — The Ember Crown</h1>
<p>The tavern was loud, and it was crowded, and it smelled of smoke and of beer and of too many people, and Mara did not like it at all.</p>
<p>She ran very quickly down the really narrow alley, her heart was pounding. Behind her, torches.</p>`;

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemo-spike-'));
  fs.mkdirSync(path.join(dir, 'documents'));
  const docs = [
    { id: 'ch3', title: 'Chapter 3', docType: 'text', content: CHAPTER },
    { id: 'map1', title: 'Characters', docType: 'mindmap',
      content: JSON.stringify({ nodes: [{ id: 'n1', data: { label: 'Mara' } }], edges: [] }) },
  ];
  for (const d of docs) fs.writeFileSync(path.join(dir, 'documents', `${d.id}.json`), JSON.stringify(d));
  const cwd = path.join(dir, 'cwd'); // empty working dir: no CLAUDE.md, no repo for the CLI to wander into
  fs.mkdirSync(cwd);
  return { dir, cwd };
}

const SYSTEM = `You are the writing assistant inside MnemoScript, a desktop app for novelists.
You can only see and change the writer's project through the mnemoscript tools.
Never invent document ids: call list_documents first. Keep the author's voice.`;

function runClaude({ prompt, mode, system = SYSTEM, project }) {
  const mcpConfig = path.join(project.dir, 'mcp.json');
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { mnemo: {
    command: process.execPath, args: [path.join(here, 'mnemo-mcp.mjs'), project.dir, mode],
  } } }));
  const args = ['-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--model', MODEL,
    '--tools', '',                      // no Bash/Read/Edit/Web… at all
    '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__mnemo',     // our tools run without the CLI's own permission prompt
    '--setting-sources', '',            // ignore the user's CLAUDE.md / hooks / settings
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt', system];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: project.cwd, env: cleanEnv, windowsHide: true });
    let buf = ''; const events = []; let stderr = '';
    child.stdout.on('data', (c) => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) try { events.push(JSON.parse(line)); } catch { /* non-JSON noise */ }
      }
    });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, events, stderr }); });
  });
}

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const init = (r) => r.events.find((e) => e.type === 'system' && e.subtype === 'init');
const result = (r) => r.events.find((e) => e.type === 'result');
const toolUses = (r) => r.events.filter((e) => e.type === 'assistant')
  .flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.name);
const finalText = (r) => result(r)?.result ?? '';
const authFailed = (r) => /authenticat|log ?in|OAuth/i.test(finalText(r)) && result(r)?.is_error;
const rateEvents = (r) => r.events.filter((e) => /rate_?limit/i.test(e.type ?? '') || /rate_?limit/i.test(e.subtype ?? ''));

const TESTS = {
  async T1() {
    const project = makeProject();
    const r = await runClaude({ prompt: 'Say OK.', mode: 'ask', project });
    const i = init(r);
    // The MCP server connects asynchronously ("pending" at init), so its tools are confirmed by T2's tool calls.
    const builtIns = (i?.tools ?? []).filter((t) => !t.startsWith('mcp__'));
    const mnemoServer = (i?.mcp_servers ?? []).find((m) => m.name === 'mnemo');
    return { pass: !!i && builtIns.length === 0 && !!mnemoServer && mnemoServer.status !== 'failed',
      detail: { builtIns, mcp_servers: i?.mcp_servers, model: i?.model, permissionMode: i?.permissionMode,
        slashCommands: (i?.slash_commands ?? []).length }, r };
  },
  async T2() {
    const project = makeProject();
    const r = await runClaude({ project, mode: 'ask',
      prompt: 'Tighten the first paragraph of Chapter 3 (cut the repetition, keep the meaning). Use edit_text.' });
    const proposals = readJsonl(path.join(project.dir, 'proposals.jsonl'));
    const applied = readJsonl(path.join(project.dir, 'applied.jsonl'));
    return { pass: proposals.length > 0 && applied.length === 0 && !authFailed(r),
      detail: { toolUses: toolUses(r), proposals, applied, reply: finalText(r).slice(0, 400) }, r };
  },
  async T3() {
    const project = makeProject();
    const r = await runClaude({ project, mode: 'plan',
      prompt: 'Plan how you would tighten Chapter 3. Do not make changes yet; give me a numbered plan.' });
    // Write tools are not even listed by the server in plan mode; any attempt would show up here.
    const writeToolsOffered = toolUses(r).filter((t) => /edit_text|add_mindmap_node/.test(t));
    const proposals = readJsonl(path.join(project.dir, 'proposals.jsonl'));
    return { pass: writeToolsOffered.length === 0 && proposals.length === 0 && /\d\./.test(finalText(r)) && !authFailed(r),
      detail: { writeToolsOffered, toolUses: toolUses(r), reply: finalText(r).slice(0, 500) }, r };
  },
  async T4() {
    // The session was started with a *different* provider. MnemoScript owns the transcript, so the new
    // provider receives it as context. Check: no refusal, and it really uses the earlier turns.
    const project = makeProject();
    const transcript = [
      ['user', 'gpt-5 (OpenAI)', 'Give my villain, Lord Caddoc, a secret that ties him to Mara.'],
      ['assistant', 'gpt-5 (OpenAI)', 'Idea: Caddoc is Mara\'s uncle. He forged the letter that exiled her mother, and he still wears her mother\'s silver ring on a chain.'],
      ['user', 'gemini-2.5-pro (Google)', 'Nice. What object could reveal it in chapter 3?'],
      ['assistant', 'gemini-2.5-pro (Google)', 'The silver ring: Mara glimpses it when Caddoc leans over the tavern table.'],
    ].map(([role, model, t]) => `[${role} · answered by ${model}]\n${t}`).join('\n\n');
    const system = `${SYSTEM}

This conversation started earlier with other AI models. The writer has now switched this project to you.
Earlier turns (for context; continue the same conversation):
<earlier_turns>
${transcript}
</earlier_turns>`;
    const r = await runClaude({ project, mode: 'plan', system,
      prompt: 'Continuing from before: which object did we pick, and who wears it? Then suggest one line of dialogue for the reveal.' });
    const reply = finalText(r);
    const usesHistory = /ring/i.test(reply) && /Caddoc/i.test(reply);
    const refused = /(can(no|')t|unable to|won't) (see|access|read|continue)|previous conversation|don't have (access|context)/i.test(reply);
    return { pass: usesHistory && !refused && !authFailed(r), detail: { usesHistory, refused, reply: reply.slice(0, 600) }, r };
  },
  async T5() {
    const project = makeProject();
    const r = await runClaude({ project, mode: 'plan', prompt: 'Say OK.' });
    const res = result(r);
    const rate = rateEvents(r);
    return { pass: rate.length > 0 && !authFailed(r),
      detail: { rateLimitEvents: rate, resultUsage: res?.usage, total_cost_usd: res?.total_cost_usd, modelUsage: res?.modelUsage,
        eventTypes: [...new Set(r.events.map((e) => `${e.type}${e.subtype ? ':' + e.subtype : ''}`))] }, r };
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TESTS);
const report = {};
for (const name of wanted) {
  process.stdout.write(`${name} … `);
  const { r, ...out } = await TESTS[name]();
  if (r && authFailed(r)) out.note = 'CLI not signed in — run `claude auth login` in a terminal, then re-run.';
  report[name] = out;
  if (r) fs.writeFileSync(path.join(outDir, `${name}.events.jsonl`), r.events.map((e) => JSON.stringify(e)).join('\n'));
  console.log(out.pass ? 'PASS' : 'FAIL', out.note ?? '');
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nReport: ${path.join(outDir, 'report.json')}`);
