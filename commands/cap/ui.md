---
name: cap:ui
description: CAP-UI local read-only server (--serve, default) or standalone HTML snapshot (--share) of Feature Map, Memory, Threads and DESIGN.md. Zero deps. Node-builtin http + SSE only.
argument-hint: "[--serve | --share] [--port N]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

<!-- @cap-context CAP F-065 /cap:ui command — orchestrates cap-ui.cjs. No agent is spawned: this is deterministic infrastructure with no wizard. -->
<!-- @cap-decision Command layer parses flags and calls cap-ui.cjs directly. No Task()/agent spawn — there is nothing conversational here. -->
<!-- @cap-decision --serve is the default because developers running /cap:ui interactively expect a browser view, not a snapshot-only export. -->
<!-- @cap-constraint Zero external deps. Do not introduce npm packages at any point in this command. -->

<!-- @cap-feature(feature:F-065) CAP-UI Core — Local Server + Static Export -->

<objective>
<!-- @cap-todo(ac:F-065/AC-1) /cap:ui --serve starts local Node http server on configurable port (default 4747), zero deps, node builtins only. -->
<!-- @cap-todo(ac:F-065/AC-2) The served UI renders Feature-Map + Memory + Threads + DESIGN.md as a readable HTML view. -->
<!-- @cap-todo(ac:F-065/AC-3) File-watcher observes FEATURE-MAP.md, DESIGN.md, .cap/memory/, .cap/SESSION.json → UI refreshes via SSE. -->
<!-- @cap-todo(ac:F-065/AC-4) /cap:ui --share generates standalone HTML snapshot at .cap/ui/snapshot.html with inline CSS/JS. -->
<!-- @cap-todo(ac:F-065/AC-5) UI is read-only for Feature-Map and Memory; DESIGN.md edit capability is introduced in F-068. -->
<!-- @cap-todo(ac:F-065/AC-6) Server logs all events (start, SSE connect, file changes) on stdout with ISO timestamps. -->

Runs one of two flows:
- `--serve` (default) — starts a local HTTP server on port 4747 (or `--port N`) that renders the Feature Map, Memory, Threads, and DESIGN.md. Broadcasts file changes to the browser via Server-Sent Events.
- `--share` — writes a standalone HTML snapshot to `.cap/ui/snapshot.html` with inline CSS/JS, safe to share via PR/Slack.

**Key guarantees:**
- Zero runtime dependencies. Only `node:` builtins (`http`, `fs`, `path`, `url`, `os`).
- Read-only: no POST/PUT/DELETE routes, no forms, no edit endpoints (F-065/AC-5). DESIGN.md editor is scoped to F-068.
- SSE-only for live updates (no WebSockets).
- Port auto-increments up to +10 if the default is taken; fails loudly otherwise.
- `--share` snapshot contains no external URLs (no Google Fonts, no CDN, no fetch calls) — safe for offline sharing.

</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 0: Parse flags

<!-- @cap-todo(ac:F-065/AC-1) Parse --serve (default), --share, --port N from $ARGUMENTS. -->

Inspect `$ARGUMENTS`:
- `--share` — set `mode = "share"`
- `--serve` — set `mode = "serve"`
- `--port N` — capture `port` (integer)
- If no mode flag, default to `mode = "serve"`

Log: `cap:ui | mode: {mode}`{ " | port: " + port if mode === 'serve' && port }

## Step 1: Dispatch by mode

### Step 1a: --share (snapshot flow)

<!-- @cap-todo(ac:F-065/AC-4) --share writes .cap/ui/snapshot.html via createSnapshot(). -->

```bash
node -e "
const ui = require('./cap/bin/lib/cap-ui.cjs');
const out = ui.createSnapshot({ projectRoot: process.cwd() });
console.log(JSON.stringify(out));
"
```

Report:

```
cap:ui --share complete.

Snapshot:  .cap/ui/snapshot.html
Bytes:     {bytes}

Next steps:
  - Open .cap/ui/snapshot.html in any browser (no server required).
  - Share via PR comment / Slack DM — inline CSS/JS, no external fetch.
  - Re-run /cap:ui --share to refresh.
```

Stop here. Do not run Step 1b.

### Step 1b: --serve (live server flow)

<!-- @cap-todo(ac:F-065/AC-1) --serve starts the local HTTP server. -->
<!-- @cap-todo(ac:F-065/AC-3) File watcher attached, SSE broadcasts change events to browser clients. -->
<!-- @cap-todo(ac:F-065/AC-6) Every server event is logged to stdout via cap-ui.logEvent. -->

Start the server in the foreground and print the URL. The server blocks until the user hits Ctrl+C (SIGINT).

```bash
node -e "
const ui = require('./cap/bin/lib/cap-ui.cjs');
const port = {PORT_OR_DEFAULT};
(async function(){
  const { url, port: actual, stop } = await ui.startServer({ projectRoot: process.cwd(), port });
  console.log('cap:ui listening on ' + url + '  (port ' + actual + ')');
  console.log('Ctrl+C to stop.');
  process.on('SIGINT', async function(){
    console.log('\\ncap:ui stopping…');
    await stop();
    process.exit(0);
  });
})().catch(function(err){ console.error('cap:ui server failed:', err.message); process.exit(1); });
"
```

Final report appears only after the user stops the server (Ctrl+C):

```
cap:ui --serve stopped.
Port:           {actual_port}
Session saved:  .cap/SESSION.json (lastCommand updated)
```

## Step 2: Update session state (both modes, fire-and-forget)

<!-- @cap-decision Session write happens after the main action so a failing --serve still reports the attempt. -->

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:ui',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'ui-{mode}'
});
"
```

</process>

## Notes

- **No agent is spawned.** cap:ui is pure infrastructure — no LLM call is required.
- **Mind-Map (F-066), Thread Navigator details (F-067), DESIGN.md editor (F-068)** are future features and are NOT implemented here. F-065 ships the scaffolding only.
- **Port conflicts**: if 4747 is taken, the server auto-tries 4748, 4749, …, up to 4757; then fails with a clear error.
- **File watcher caveats**: `fs.watch` is platform-specific. Linux fires multiple events per write (inotify); macOS coalesces via FSEvents. A 100ms debounce smooths the difference.
- **Read-only guarantee**: the HTML has no `<form>`, no POST targets, and the server rejects non-GET/HEAD methods with 405.
