# How it works

What each part of the project demonstrates, with the responses the servers actually return. Code is referred to by file and function name.

## 1. The SDK server: how a request travels

1. **The front door** (`src/sdk-server/http.ts`). Plain Node HTTP with three guards before any MCP code runs: `GET /mcp` returns `405` with `Allow: POST`, any other path returns `404`, and a body that is not JSON returns `400 invalid JSON`. A `405` on `GET` is consistent with the 2026 revision, which replaced the old GET stream with `subscriptions/listen` over POST.
2. **One server per request** (`createHttpServer`). Each request builds a fresh `McpServer` and a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`. No session id is issued, and `tools/list` works without a prior `initialize`. Because nothing survives a request, state that must outlive one lives in `JobStore`, created once in `main.ts`.
3. **A tool** (`registerTool` in `src/sdk-server/server.ts`): a name, a description, a zod input shape and a handler. The SDK turns the zod shape into JSON Schema for `tools/list` and validates arguments before the handler runs.

## 2. Three kinds of failure

| Case                               | What comes back                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo` with `text: 5`              | HTTP 200, a normal result with `isError: true`, text `MCP error -32602: Input validation error: Invalid arguments for tool echo: Invalid input: expected string, received number at text` |
| Unknown tool                       | The same shape: a result with `isError: true`, text `MCP error -32602: Tool nope not found`                                                                                               |
| Unknown method (`server/discover`) | A JSON-RPC error: `{"error":{"code":-32601,"message":"Method not found"}}`                                                                                                                |

Problems with a tool call come back as results with `isError`; problems with the protocol itself come back as JSON-RPC errors. The SDK's validator names the failing field (`at text`). `call_item` does the same for per-item input through `validateInput` in `src/catalog/items.ts`: a bad enum and a bad range come back together as `input.mode: ...` and `input.maxResults: ...`, so a caller can fix both in one retry.

## 3. Handles, idempotency and cost

`src/catalog/jobs.ts` holds the job logic.

- `start_job` twice with the same `idempotencyKey` returns the same `jobId`, with `deduplicated: true` the second time. The key is a tool argument and not the JSON-RPC request id, because a re-issued request carries a new id.
- A `maxCostUsd` below the item's price is refused before any work starts. A real system also needs a meter that stops a running job when spend crosses the cap; this project checks the cap only at the gate.
- `get_result` reads `running`, then `succeeded` once the delay has passed. After a restart the same `jobId` returns `No job ...`: a handle only works across processes if its state lives in shared storage.

## 4. The hand-written server

It is layered so the protocol rules can be read, and tested, without any HTTP:

```
http.ts       reads the body, calls handleRpc, writes status + JSON
handler.ts    parses, checks the rules, dispatches by method
protocol/     validateRequest, discoverResult, error codes, JSON-RPC builders
```

### Step 1: envelope and discovery

`ok` and `fail` in `src/protocol/jsonrpc.ts` are the whole JSON-RPC response layer. `server/discover` replaces the handshake: it returns `supportedVersions`, `capabilities`, identity under `_meta`, `instructions`, and `ttlMs` plus `cacheScope` so a client can cache it. Any other method gets `404` with `-32601`. `capabilities` is empty until the server implements tools.

### Step 2: the per-request rules

| Question                  | Answer                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing `_meta`?          | `400`, `-32602`: a malformed request                                                                                                                                                                                                             |
| Header and body disagree? | `400`, `-32020`: the version header against `_meta`, `Mcp-Method` against `method`, and `Mcp-Name` against `params.name` for `tools/call`. A gateway can route on the headers without parsing the body, so the server makes sure they cannot lie |
| Version `1900-01-01`?     | `400`, `-32022`, with `data: {"supported": ["2026-07-28"], "requested": "1900-01-01"}`, so the client knows what to retry with                                                                                                                   |

Three codes, three different failures: malformed (`-32602`), self-contradicting (`-32020`), and well-formed but a version this server does not speak (`-32022`).

Two implementation choices that are not spec text: the order of checks in `validateRequest`, and answering `initialize` with `-32022` plus the supported versions (the spec says a modern-only server SHOULD name its supported versions in errors to `initialize`).

## 5. The two revisions side by side

| Aspect               | SDK server (2025-11-25)                                       | Hand-written server (2026-07-28)                                                                    |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Handshake            | `initialize` accepted                                         | Removed: `400`, `-32022` with supported versions                                                    |
| Session id           | None issued in stateless mode; the protocol still supports it | Removed from the protocol                                                                           |
| `server/discover`    | `-32601` (the SDK predates it)                                | Required; returns versions, capabilities, instructions, cache fields                                |
| Per-request metadata | Not required                                                  | `_meta` version and capabilities required; `MCP-Protocol-Version` and `Mcp-Method` headers required |
| Unknown method       | HTTP 200 carrying a JSON-RPC `-32601`                         | HTTP 404 with `-32601`                                                                              |
| Response format      | SSE frame, even for one reply                                 | Plain JSON (the spec allows either)                                                                 |

## 6. Tests

`npm test` runs Vitest. Tests are split by what they need:

- Pure logic with no network: `test/catalog/*` and `test/server-2026/handler.test.ts` (every rejection case, calling `handleRpc` directly).
- End to end over HTTP on a random port: `test/server-2026/http.test.ts` and `test/sdk-server/http.test.ts`.

## 7. Exercises

- Change `sessionIdGenerator: undefined` to `() => randomUUID()` in `src/sdk-server/http.ts`, restart, and send `initialize`. An `mcp-session-id` response header appears: the header the new revision removed.
- Predict which code each of these returns, then check: a version header that differs from `_meta`, and a version of `1900-01-01` in both places.
- Start a job, restart the server, then call `get_result` with the returned id. Describe what a production system would store, and where.
