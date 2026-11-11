# How it works

What each part of the project demonstrates, with the responses the servers actually return. Code is referred to by file and function name.

## 1. The SDK server: how a request travels

1. **The front door** (`src/sdk-server/http.ts`). Plain Node HTTP with three guards before any MCP code runs: a path other than `/mcp` returns `404`, a method other than `POST` returns `405` with `Allow: POST`, and a body that is not JSON returns `400 invalid JSON`. A `405` on `GET` is consistent with the 2026 revision, which replaced the old GET stream with `subscriptions/listen` over POST.
2. **One server per request** (`createHttpServer`). Each request builds a fresh `McpServer` and a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`. No session id is issued, and `tools/list` works without a prior `initialize`. Because nothing survives a request, state that must outlive one lives in `JobStore`, created once in `main.ts`.
3. **The SDK's own checks** (inside `transport.handleRequest`). The transport answers `406` unless `Accept` lists both `application/json` and `text/event-stream`, `415` unless `Content-Type` is `application/json`, `400` for an `MCP-Protocol-Version` header it does not support (`2026-07-28` is one), and `400` with `-32700` for a JSON body that is not a JSON-RPC message, such as `null`. A notification (a message without an `id`) is acknowledged with `202` and no body.
4. **A tool** (`registerTool` in `src/sdk-server/server.ts`): a name, a description, a zod input shape and a handler. The SDK turns the zod shape into JSON Schema for `tools/list` and validates arguments before the handler runs.

## 2. Three kinds of failure

| Case                               | What comes back                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo` with `text: 5`              | HTTP 200, a normal result with `isError: true`, text `MCP error -32602: Input validation error: Invalid arguments for tool echo: Invalid input: expected string, received number at text` |
| Unknown tool                       | The same shape: a result with `isError: true`, text `MCP error -32602: Tool nope not found`                                                                                               |
| Unknown method (`server/discover`) | A JSON-RPC error: `{"error":{"code":-32601,"message":"Method not found"}}`                                                                                                                |

Problems with a tool call come back as results with `isError`; problems with the protocol itself come back as JSON-RPC errors. The SDK's validator names the failing field (`at text`). `call_item` does the same for per-item input through `validateInput` in `src/catalog/items.ts`: a bad enum and a bad range come back together as `input.mode: ...` and `input.maxResults: ...`, so a caller can fix both in one retry.

## 3. Handles, idempotency and cost

`src/catalog/jobs.ts` holds the job logic.

- `start_job` twice with the same `idempotencyKey` returns the same `jobId`, with `deduplicated: true` the second time. The key is a tool argument and not the JSON-RPC request id, because a re-issued request carries a new id. The store compares only the key: a second `start_job` with the same key and a different item or input returns the first job. A production API would also compare the arguments, and refuse a key that is reused with different ones.
- A `maxCostUsd` below the item's price is refused before any work starts. A real system also needs a meter that stops a running job when spend crosses the cap; this project checks the cap only at the gate.
- `get_result` reads `running`, then `succeeded` once the delay has passed. After a restart the same `jobId` returns `No job ...`: a handle only works across processes if its state lives in shared storage.

## 4. The hand-written server

It is layered so the protocol rules can be read, and tested, without any HTTP:

```
http.ts       reads the body, calls handleRpc, writes status + JSON
handler.ts    parses, checks the envelope and the rules, dispatches by method
protocol/     type guards, validateRequest, discoverResult, error codes, JSON-RPC builders
```

### Step 1: envelope and discovery

`ok` and `fail` in `src/protocol/jsonrpc.ts` build every JSON-RPC response. `isRpcRequest`, in the same file, is the gate every request passes first. A body that is valid JSON but not a JSON-RPC 2.0 request (`null`, an array, a `method` that is not a string, an `id` that is an object) is refused with `-32600` and `id: null` before any member of it is used.

`server/discover` replaces the handshake: it returns `supportedVersions`, `capabilities`, identity under `_meta`, `instructions`, and `ttlMs` plus `cacheScope` so a client can cache it. Any other method gets `404` with `-32601`. `capabilities` is empty until the server implements tools.

### Step 2: the per-request rules

| Question                      | Answer                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required header missing?      | `400`, `-32020`. `MCP-Protocol-Version` and `Mcp-Method` are required on every request, `Mcp-Name` on `tools/call`, `prompts/get` and `resources/read`                                                                                                                                           |
| `_meta` missing or malformed? | `400`, `-32602`: a malformed request. The protocol version must be a string and the client capabilities an object                                                                                                                                                                                |
| Header and body disagree?     | `400`, `-32020`: the version header against `_meta`, `Mcp-Method` against `method`, and `Mcp-Name` against `params.name` (`tools/call`, `prompts/get`) or `params.uri` (`resources/read`). A gateway can route on the headers without parsing the body, so the server makes sure they cannot lie |
| Version `1900-01-01`?         | `400`, `-32022`, with `data: {"supported": ["2026-07-28"], "requested": "1900-01-01"}`, so the client knows what to retry with                                                                                                                                                                   |

Three codes, three different failures: malformed (`-32602`), headers that are missing or contradict the body (`-32020`), and well-formed but a version this server does not speak (`-32022`). The first failing rule wins. The order is the headers, then `_meta`, then the version, so a request with no MCP headers and no `_meta` gets `-32020`.

Two implementation choices that are not spec text: the order of checks in `validateRequest`, and answering `initialize` with `-32022` plus the supported versions (the spec says a modern-only server SHOULD name its supported versions in errors to `initialize`). `initialize` is answered before the per-request rules run, because a 2025 client sends none of the new headers.

## 5. Surviving bad input

Both servers must stay up whatever a client sends. Three things make that harder than it looks:

- **The request listener is `async`.** Node's HTTP server does not catch an error thrown inside it. The error becomes an unhandled rejection, and Node ends the process: one bad request would take the server down for every client.
- **`JSON.parse` returns any JSON value.** `null`, `5` and `[]` are valid JSON, and reading `.method` from `null` throws. So a parsed body is typed `unknown` until `isRecord` or `isRpcRequest` (`src/protocol/jsonrpc.ts`) has narrowed it.
- **A JSON object can shadow built-in members.** In `{"method": {"toString": 1}}` the `method` is an object whose `toString` is not a function, so `String(method)` and a template literal both throw. The code shows a value from the body with `JSON.stringify`, and looks method names up in a `Map` and not in a plain object.

A client can also disconnect in the middle of a body, which makes the loop that reads the body throw. Both servers catch that error.

The HTTP tests send inputs like these over a real socket, then check that the server still answers: see `bad clients` in `test/server-2026/http.test.ts` and `transport guards` in `test/sdk-server/http.test.ts`.

## 6. The two revisions side by side

| Aspect                      | SDK server (2025-11-25)                                       | Hand-written server (2026-07-28)                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handshake                   | `initialize` accepted                                         | Removed: `400`, `-32022` with supported versions                                                                                                                      |
| Session id                  | None issued in stateless mode; the protocol still supports it | Removed from the protocol                                                                                                                                             |
| `server/discover`           | `-32601` (v1 of the SDK does not implement it)                | Required; returns versions, capabilities, instructions, cache fields                                                                                                  |
| Per-request metadata        | Not required                                                  | `_meta` version and capabilities required; `MCP-Protocol-Version` and `Mcp-Method` headers required, plus `Mcp-Name` for a call that names a tool, prompt or resource |
| Unknown method              | HTTP 200 carrying a JSON-RPC `-32601`                         | HTTP 404 with `-32601`                                                                                                                                                |
| Response format             | SSE frame, even for one reply                                 | Plain JSON (the spec allows either)                                                                                                                                   |
| Notification                | `202` with no body                                            | Not handled yet: answered like a request (see Known gaps in the README)                                                                                               |
| `Accept` and `Content-Type` | Checked by the SDK: `406` and `415`                           | Not checked                                                                                                                                                           |

## 7. Tests

`npm test` runs Vitest. Tests are split by what they need:

- Pure logic with no network: `test/catalog/*` (item input validation, search and the job store), `test/protocol/*` (the type guards, the reply builders and every rule of `validateRequest`) and `test/server-2026/handler.test.ts` (every rejection case, calling `handleRpc` directly).
- End to end over HTTP on a random port: `test/server-2026/http.test.ts` and `test/sdk-server/http.test.ts`. They also cover the request log and the misbehaving clients of section 5.

## 8. Exercises

- Add `import { randomUUID } from 'node:crypto';` to `src/sdk-server/http.ts` and change `sessionIdGenerator: undefined` to `sessionIdGenerator: () => randomUUID()`. Restart, and send `initialize`. An `mcp-session-id` response header appears: the header the new revision removed. Then send `tools/list`. It now fails with `400` and `Server not initialized`, because every request builds a new transport, and a transport with sessions expects `initialize` first. Explain what a server with sessions has to keep between requests.
- Predict which code each of these returns, then check: a version header that differs from `_meta`, and a version of `1900-01-01` in both places.
- Start a job, restart the server, then call `get_result` with the returned id. Describe what a production system would store, and where.
- Send the hand-written server a valid request with an extra `Origin: http://evil.example` header. It answers `200`. Read the `Origin` rule in [spec-2026-07-28.md](spec-2026-07-28.md), then add the check and a test for it.
