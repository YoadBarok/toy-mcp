# AGENTS.md

Guidance for coding agents and contributors.

## What this is

Two small MCP servers: an SDK-based baseline (protocol 2025-11-25) and a hand-written server for the 2026-07-28 revision, built step by step. The point is to make the protocol visible, so changes should stay small, runnable and explained: say what a change demonstrates, not only what it does.

## Commands

```bash
npm install
npm start            # SDK server on :3333
npm run start:2026   # hand-written server on :3334
npm run check        # typecheck + lint + tests; must pass before a change is done
```

Start servers for verification on a spare `PORT`, and stop them afterwards, so a server already running locally is not disturbed.

## Layout

- `src/protocol/`: pure protocol logic (JSON-RPC builders, error codes, per-request validation, `server/discover`). No HTTP, no I/O.
- `src/catalog/`: the shared toy marketplace (items, input validation, job store).
- `src/sdk-server/`, `src/server-2026/`: one server each, as a thin HTTP transport over the logic above.
- `test/` mirrors `src/`. `postman/` has a request for every behavior. `docs/` explains it.

## Rules

- **The hand-written server stays hand-written.** `src/server-2026/` and `src/protocol/` must not import the MCP SDK; Node built-ins only.
- **The SDK server stays the 2025-era baseline.** Do not upgrade it to the new revision: the contrast between the two is the point.
- **Spec fidelity.** Every protocol claim must trace to `docs/spec-2026-07-28.md`. If a detail is missing there, read the published spec at https://modelcontextprotocol.io/specification/2026-07-28/ and add it with its source, marking it if it was not confirmed against the schema text. State plainly when behavior is an implementation choice rather than something the spec requires.
- **Verify before reporting.** Run `npm run check`, start the server, send real requests and report what came back. Do not describe expected behavior as observed behavior.
- **A new behavior comes with:** tests in `test/`, a request in `postman/toy-mcp.postman_collection.json` (Postman v2.1; the request name states the expected status and code), an updated step table in `README.md`, and a note in `docs/how-it-works.md`.
- **Document requests as method, URL, headers and body.** When showing curl, write every header out in full; never put headers in a shell variable (zsh does not split it).

## Style

- Single quotes. Prettier (`.prettierrc.json`) formats and ESLint's `quotes` rule enforces.
- Comments only for a constraint the code cannot show; none that narrate the next line.
- Keep TypeScript on 6.0.x until `typescript-eslint` supports 7.
- Small commits, one step or concern each. No secrets and no `node_modules`.
