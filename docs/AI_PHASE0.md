# AI Assistant — Phase 0 findings (2026-11-12)

Phase 0 tested whether MnemoScript can drive a writer's own AI subscription safely, and whether one
chat session can move between AI models (plan A) or must be one model per session (plan B).

**Result: plan A works.** A session can continue on a different model. Every test passed against
Claude Code 2.1.215 on a Claude Pro account. Gemini CLI and Codex are not installed on the test PC,
so the reverse direction (Claude → another model) is not yet tested; it uses the same mechanism.

Re-run: `cd app && node scripts/ai-spike/run-spike.mjs` (needs `claude auth login` once). The raw
event streams land in `app/scripts/ai-spike/out/` (git-ignored).

## How the spike drives the CLI

`run-spike.mjs` starts the user's installed `claude` the way the desktop app will:

```
claude -p <prompt> --output-format stream-json --verbose --model <m>
  --tools ""                      # no Bash / Read / Edit / Web — nothing built in
  --strict-mcp-config --mcp-config <mnemo server>
  --allowedTools mcp__mnemo       # our tools run without the CLI's own prompts
  --setting-sources "" --disable-slash-commands --no-session-persistence
  --system-prompt <MnemoScript prompt + replayed transcript>
```

- **Clean environment.** Only PATH/HOME/APPDATA-type variables are passed. Inheriting another Claude
  session's `CLAUDE_*` variables (e.g. `CLAUDE_CODE_SIMPLE=1`) makes the CLI ignore its own sign-in.
- **Empty working folder.** The CLI never sees the project folder or a CLAUDE.md.
- `mnemo-mcp.mjs` is the only way in: `list_documents`, `read_document`, `edit_text`,
  `add_mindmap_node`. **Modes are enforced by the server, not the model:** plan mode does not list
  the write tools at all, ask mode queues writes as proposals, auto mode applies them. This is
  provider-neutral, so the same rules will hold for Gemini, Codex and API-key providers.

## Results

| Test | What it checks | Result |
|---|---|---|
| T1 lockdown | 0 built-in tools, 0 slash commands, our MCP server connected | ✅ |
| T2 ask mode | "Tighten paragraph 1" → `list_documents` → `read_document` → `edit_text`; the edit landed in proposals, nothing applied | ✅ |
| T3 plan mode | Only read tools used, a numbered plan returned, no proposals | ✅ |
| T4 handoff | Transcript written by "gpt-5" and "gemini-2.5-pro" replayed in the system prompt; Claude recalled the ring and Caddoc and continued — no refusal | ✅ |
| T5 usage | Stream carries `rate_limit_event` | ✅ (partly — see below) |

Example T2 proposal: *"The tavern was loud, and it was crowded, and it smelled of smoke…"* →
*"The tavern was loud and crowded, reeking of smoke and beer and unwashed bodies. Mara hated it."*

## Usage and account data (for Settings)

- **Account:** `claude auth status --json` → `loggedIn`, `authMethod: "claude.ai"`, `email`,
  `orgName`, `subscriptionType` (e.g. `"pro"`). Enough for the account card.
- **Limits:** each run emits
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","resetsAt":<unix>,…}}`.
  The CLI fills `utilization` (0–1) from the `anthropic-ratelimit-unified-<window>-utilization`
  header, but it only shows up once a warning threshold is crossed (`status: "allowed_warning"`),
  and only for the window that applies (`five_hour`, `seven_day`, `seven_day_opus`, …).
- **Consequence for the progress bars:** we always know *which* window applies and *when it
  resets*. We know the exact percentage only near the limit. The bars will therefore show:
  reset countdown always; the percentage when the CLI reports it; otherwise "Plenty left" plus how much
  MnemoScript itself used (tokens / `total_cost_usd` per turn, both in the `result` event). Reading
  Anthropic's private usage endpoint with the user's sign-in token is **not** an option — that is
  exactly the third-party token use Anthropic's terms forbid.
- **Not signed in** shows up as a `result` with `is_error: true` and
  `"Failed to authenticate: OAuth session expired…"` → the app shows "Sign in to Claude Code" with
  the `claude auth login` command.

## Design decisions this settles

1. **Plan A:** sessions are owned by MnemoScript (`<project>/ai/sessions/<id>.json`). Each message
   records the model that wrote it; switching models replays the transcript as context. Tool calls are
   stored as plain-text summaries so any provider can read them. The session icon shows every model
   used, newest first. Plan B is not needed.
2. One CLI process per turn (`-p`, no CLI-side persistence) keeps MnemoScript the single source of
   truth. Later, for speed, a long-lived `--input-format stream-json` process can be kept per session
   while the model does not change.
3. Ask mode needs no CLI permission hooks: the MCP write tool itself returns "Proposed", and the app
   shows the Apply / Reject card.
4. Spawn with a clean environment and an empty working folder, always.

## Still open (Phase 1+)

- Install and test Gemini CLI (`--experimental-acp`) and Codex (`codex app-server`,
  `account/rateLimits/read` returns both windows with percentages).
- Android: no CLI, so API keys only (or pairing with the desktop later).
- `npx`-free packaging: the real MCP server will be a Rust sidecar or a small bundled Node script;
  decide in Phase 1.
