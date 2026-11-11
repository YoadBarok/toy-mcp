# AGENTS.md

Guidance for coding agents and contributors.

## What this is

Two small MCP servers: a baseline built on v1 of the official TypeScript SDK (protocol 2025-11-25) and a hand-written server for the 2026-07-28 revision, built step by step. The point is to make the protocol visible, so changes should stay small, runnable and explained: say what a change demonstrates, not only what it does.

## Commands

```bash
npm install
npm start            # SDK server on :3333
npm run start:2026   # hand-written server on :3334
npm run check        # typecheck + lint + format check + tests; must pass before a change is done
npm run format       # rewrite files to the Prettier style
```

Node 20.19+, 22.13+ or 24+ (see `engines` in `package.json`).

Start servers for verification on a spare `PORT`, and stop them afterwards, so a server already running locally is not disturbed.

## Layout

- `src/protocol/`: pure protocol logic (JSON-RPC types, type guards and reply builders, error codes, per-request validation, `server/discover`). No HTTP, no I/O.
- `src/catalog/`: the toy marketplace (items, input validation, job store). Only the SDK server uses it today. The hand-written server will use it from step 3.
- `src/sdk-server/`, `src/server-2026/`: one server each. `http.ts` is a thin HTTP transport and `main.ts` is the entry point.
- `test/` mirrors `src/`. `postman/` has ready-made requests for the behaviors worth trying by hand. `docs/` explains it.

## Rules

- **The hand-written server stays hand-written.** `src/server-2026/` and `src/protocol/` must not import the MCP SDK; Node built-ins only. ESLint enforces this with `no-restricted-imports`.
- **The SDK server stays the 2025-era baseline.** Keep it on v1 of the SDK (`@modelcontextprotocol/sdk`). Do not move it to v2 (`@modelcontextprotocol/server`), which implements the new revision: the contrast between the two servers is the point.
- **Untrusted input stays `unknown` until a type guard narrows it.** A parsed request body is `unknown`. Use `isRecord` and `isRpcRequest` from `src/protocol/jsonrpc.ts` before reading a member. Show a value from the body with `JSON.stringify`, never with `String()` or a template literal: both throw for an object whose `toString` is not a function. Nothing may throw inside a request listener, because the listener is `async` and an escaped error is an unhandled rejection, which ends the Node process. A fix for a crash comes with a regression test that sends the input over a real socket.
- **Spec fidelity.** Every protocol claim must trace to `docs/spec-2026-07-28.md`. If a detail is missing there, read the published spec at https://modelcontextprotocol.io/specification/2026-07-28/ and add it with its source, marking it _(unconfirmed)_ if it was not checked against the schema text. State plainly when behavior is an implementation choice rather than something the spec requires.
- **Verify before reporting.** Run `npm run check`, start the server, send real requests and report what came back. Do not describe expected behavior as observed behavior.
- **A new behavior comes with:** tests in `test/`; a request with a description in `postman/toy-mcp.postman_collection.json` (Postman v2.1; the request name ends with `->` and the expected HTTP status, plus the error code or `isError` where there is one); an updated step table, error table or list of known gaps in `README.md`; and a note in `docs/how-it-works.md`. `README.md` states the number of requests in the collection, so update it when the number changes.
- **Document requests as method, URL, headers and body.** When showing curl, write every header out in full.

## Style

- Single quotes. Prettier (`.prettierrc.json`) formats and ESLint's `quotes` rule enforces.
- **Every file in `src/` starts with an `@file` comment** saying what it contains and, for protocol code, which part of `docs/spec-2026-07-28.md` it implements.
- **Every exported function, class, type and constant has a TSDoc comment** (`/** ... */`) that says what it is for and what it guarantees. Functions also document each parameter (`@param name - ...`) and the return value (`@returns`), including what `null` or `undefined` means. Do not repeat TypeScript types inside TSDoc tags. ESLint (`eslint-plugin-jsdoc`) enforces this for `src/`, so `npm run lint` fails on a missing docstring.
- **Inline comments explain why**: the spec rule a check implements, a deliberate choice, or a constraint the code cannot show. They do not restate what the next line does. Update a comment in the same commit as the code it describes, so it never goes stale.
- Tests are documented by clear `describe` and `it` names plus a short comment at the top of each file.
- Keep TypeScript on 6.0.x until `typescript-eslint` supports a newer release.
- Small commits, one step or concern each. No secrets and no `node_modules`.
