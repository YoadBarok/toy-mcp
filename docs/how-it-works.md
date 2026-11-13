# How it works

What each part of the project demonstrates, with the responses the servers actually return. Code is referred to by file and function name.

## 1. The SDK server: how a request travels

1. **The front door** (`src/sdk-server/http.ts`). Plain Node HTTP with three guards before any MCP code runs: a path other than `/mcp` (or `/mcp-session`, described below) returns `404`, a method other than `POST` returns `405` with `Allow: POST`, and a body that is not JSON returns `400 invalid JSON`. A `405` on `GET` is consistent with the 2026 revision, which replaced the old GET stream with `subscriptions/listen` over POST.
2. **One server per request** (`createHttpServer`). Each request builds a fresh `McpServer` and a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`. No session id is issued, and `tools/list` works without a prior `initialize`. Because nothing survives a request, state that must outlive one lives in `JobStore`, created once in `main.ts`.
3. **The SDK's own checks** (inside `transport.handleRequest`). The transport answers `406` unless `Accept` lists both `application/json` and `text/event-stream`, `415` unless `Content-Type` is `application/json`, `400` for an `MCP-Protocol-Version` header it does not support (`2026-07-28` is one), and `400` with `-32700` for a JSON body that is not a JSON-RPC message, such as `null`. A notification (a message without an `id`) is acknowledged with `202` and no body.
4. **A tool** (`registerTool` in `src/sdk-server/server.ts`): a name, a description, a zod input shape and a handler. The SDK turns the zod shape into JSON Schema for `tools/list` and validates arguments before the handler runs.

Both servers use plain `node:http` on purpose, so the path check, the method check and the body reading are visible. A real service would use a framework such as Express, Fastify or Hono: a router does the first two, middleware does the third along with authentication and rate limits, and the MCP handling becomes one route handler. The routing that matters in MCP is one level down anyway: every request goes to the same URL, and the JSON-RPC `method` decides what runs.

### Session mode: asking the user

`confirm_purchase` cannot finish on its own: it must ask the user to confirm the price. In the 2025-11-25 revision the server does that with elicitation, a request that travels from the server to the client. Over HTTP a server cannot open a connection to a client, so the exchange is built from three pieces:

1. The client sends `tools/call`. The response is an SSE stream, and the server keeps it open.
2. The server writes its own request, `elicitation/create`, onto that stream, and the tool waits.
3. The client sends the answer as a new POST: a JSON-RPC response whose `id` matches the question.

The answer in step 3 is a separate HTTP request. It only helps if it reaches the same server object whose tool is waiting in step 2. That is what a session provides (`src/sdk-server/sessions.ts`): `initialize` on `/mcp-session` creates a server and a transport, stores them in a map under a random id, and returns the id in the `Mcp-Session-Id` header. Each later request carries the id and is passed to the same transport. `DELETE` removes the entry.

What the route shows when the session is missing:

| Request                                    | Reply                   | Why                                                                         |
| ------------------------------------------ | ----------------------- | --------------------------------------------------------------------------- |
| Any request without `Mcp-Session-Id`       | `400`, `-32000`         | The server cannot tell which session it belongs to                          |
| A request with an id the map does not hold | `404`, `-32000`         | The session ended or the server restarted; the client must initialize again |
| The answer sent to the stateless `/mcp`    | `202`, and nothing more | A fresh server has no call waiting, so the answer is dropped silently       |
| `confirm_purchase` on the stateless `/mcp` | A result with `isError` | A fresh server never saw `initialize`, so the SDK refuses to ask            |

The cost of a session is that the map lives in one process. With several processes behind a load balancer, every request of a session must reach the process that opened it (sticky routing), or the session state must move to a shared store. A restart ends every session. The 2026-07-28 revision removes sessions for this reason, and step 5 shows how it asks the same question without one.

The tool itself knows none of this. In `src/catalog/tools.ts` it is a function of its arguments and an optional answer: without an answer it returns the question (`NeedsInput`), with one it returns the outcome. The SDK server gets the answer through elicitation and calls the tool a second time.

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

### What stands in for what

`JobStore` is deliberately small. Each part of it stands in for something a real deployment needs:

| In this project                                  | In production                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `Map` of jobs in the server's memory           | A database row per job, which every process can read and which survives a restart. Large results go to object storage and the row holds a pointer |
| A `Map` from idempotency key to `jobId`          | A unique constraint in the database, or an atomic `SET NX` in Redis, so two processes that receive the same retry cannot both start a job         |
| `setTimeout` that flips the job to `succeeded`   | A message queue and worker processes. `start_job` saves the job and publishes its id; a worker picks it up, does the work and writes the result   |
| Two states, `running` and `succeeded`            | At least `queued`, `running`, `succeeded` and `failed`, and usually `cancelled` and `timed_out`                                                   |
| The cost cap checked once, before the job starts | The same check, plus a meter the worker reports to, which stops a run that crosses the cap                                                        |

`get_result` stays as it is in every version: it reads the job by its id and never talks to the queue.

A queue delivers a message at least once, so a worker can receive the same job twice and must check the job's state before starting. Saving the job and publishing the message are two writes to two systems; if the second fails, the job stays `queued` forever. The usual fix is to write the message to a table in the same transaction and let a separate process publish it (the outbox pattern).

## 4. The hand-written server

It is layered so the protocol rules can be read, and tested, without any HTTP:

```
http.ts       reads the body, calls handleRpc, writes status + JSON
handler.ts    parses, checks the envelope and the rules, dispatches by method
tools.ts      the tools, tools/list and tools/call
protocol/     type guards, validateRequest, discoverResult, error codes, JSON-RPC and result builders
```

### Step 1: envelope and discovery

`ok` and `fail` in `src/protocol/jsonrpc.ts` build every JSON-RPC response. `isRpcRequest`, in the same file, is the gate every request passes first. A body that is valid JSON but not a JSON-RPC 2.0 request (`null`, an array, a `method` that is not a string, an `id` that is an object) is refused with `-32600` and `id: null` before any member of it is used.

`server/discover` replaces the handshake: it returns `supportedVersions`, `capabilities`, identity under `_meta`, `instructions`, and `ttlMs` plus `cacheScope` so a client can cache it. Any other method gets `404` with `-32601`. `capabilities` lists what the server implements: `{ "tools": {} }` since step 3.

### Step 2: the per-request rules

| Question                      | Answer                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required header missing?      | `400`, `-32020`. `MCP-Protocol-Version` and `Mcp-Method` are required on every request, `Mcp-Name` on `tools/call`, `prompts/get` and `resources/read`                                                                                                                                           |
| `_meta` missing or malformed? | `400`, `-32602`: a malformed request. The protocol version must be a string and the client capabilities an object                                                                                                                                                                                |
| Header and body disagree?     | `400`, `-32020`: the version header against `_meta`, `Mcp-Method` against `method`, and `Mcp-Name` against `params.name` (`tools/call`, `prompts/get`) or `params.uri` (`resources/read`). A gateway can route on the headers without parsing the body, so the server makes sure they cannot lie |
| Version `1900-01-01`?         | `400`, `-32022`, with `data: {"supported": ["2026-07-28"], "requested": "1900-01-01"}`, so the client knows what to retry with                                                                                                                                                                   |

Three codes, three different failures: malformed (`-32602`), headers that are missing or contradict the body (`-32020`), and well-formed but a version this server does not speak (`-32022`). The first failing rule wins. The order is the headers, then `_meta`, then the version, so a request with no MCP headers and no `_meta` gets `-32020`.

Two implementation choices that are not spec text: the order of checks in `validateRequest`, and answering `initialize` with `-32022` plus the supported versions (the spec says a modern-only server SHOULD name its supported versions in errors to `initialize`). `initialize` is answered before the per-request rules run, because a 2025 client sends none of the new headers.

### Step 3: tools

Every tool is defined once, in `src/catalog/tools.ts`, and both servers expose the same list. The SDK server hands each definition to `registerTool`; `src/server-2026/tools.ts` does by hand what the SDK does out of sight. Three jobs become visible:

- **Publishing the schema.** `tools/list` must return each tool's arguments as JSON Schema. `listToolsResult` converts the tool's zod schema with `z.toJSONSchema`, in input mode, so a field with a default is not listed as required.
- **Validating the arguments.** The same zod schema is applied to `params.arguments` before the tool runs.
- **Choosing the kind of failure.**

| What went wrong                                        | Reply                                                         | Who can act on it                         |
| ------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| Unknown tool, or `arguments` is not an object          | `400`, JSON-RPC error `-32602`                                | The client's developer: the call is wrong |
| Arguments the tool's schema rejects                    | `200`, result with `isError: true`, every failing field named | The model: it can correct and retry       |
| The tool ran and failed (unknown item, bad item input) | `200`, result with `isError: true`                            | The model                                 |

Every result carries `resultType: "complete"`. No method writes that field itself: each one builds its own payload and passes it through `complete` in `src/protocol/result.ts`, which also attaches the cache hint when one is given. The `tools/list` result also carries `ttlMs` and `cacheScope: "public"`: the list is the same for every caller, so a shared cache may keep it.

Two implementation choices that are not spec text: returning arguments that fail the schema as an `isError` result (the SDK server does the same), and the `ttlMs` of five minutes.

### Step 4: job tools

`start_job` and `get_result` now come from the same shared definitions, so the hand-written server exposes the same tools as the SDK server. `buildTools(jobs)` takes the job store as an argument: a tool cannot hold a job, because a job outlives the request that started it.

Each server creates one `JobStore` in its `main.ts` and passes it down. In the hand-written server, `createHandler(jobs)` returns the request handler, and the store is the only thing that survives between two requests.

Nothing in the protocol layer changed for this step, and that is the point. `start_job` ends its request with a `jobId`. `get_result` arrives later as an unrelated request: no session, no `initialize`, possibly another connection. The handle carries everything the server needs. This is why the handle pattern already fit the 2025 server in stateless mode and fits the 2026-07-28 revision without changes.

## 5. Surviving bad input

Both servers must stay up whatever a client sends. Three things make that harder than it looks:

- **The request listener is `async`.** Node's HTTP server does not catch an error thrown inside it. The error becomes an unhandled rejection, and Node ends the process: one bad request would take the server down for every client.
- **`JSON.parse` returns any JSON value.** `null`, `5` and `[]` are valid JSON, and reading `.method` from `null` throws. So a parsed body is typed `unknown` until `isRecord` or `isRpcRequest` (`src/protocol/jsonrpc.ts`) has narrowed it.
- **A JSON object can shadow built-in members.** In `{"method": {"toString": 1}}` the `method` is an object whose `toString` is not a function, so `String(method)` and a template literal both throw. The code shows a value from the body with `JSON.stringify`, and looks method names up in a `Map` and not in a plain object.

A client can also disconnect in the middle of a body, which makes the loop that reads the body throw. Both servers catch that error.

The HTTP tests send inputs like these over a real socket, then check that the server still answers: see `bad clients` in `test/server-2026/http.test.ts` and `transport guards` in `test/sdk-server/http.test.ts`.

## 6. The two revisions side by side

| Aspect                      | SDK server (2025-11-25)                               | Hand-written server (2026-07-28)                                                                                                                                      |
| --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handshake                   | `initialize` accepted                                 | Removed: `400`, `-32022` with supported versions                                                                                                                      |
| Session id                  | None on `/mcp`; issued and required on `/mcp-session` | Removed from the protocol                                                                                                                                             |
| `server/discover`           | `-32601` (v1 of the SDK does not implement it)        | Required; returns versions, capabilities, instructions, cache fields                                                                                                  |
| Per-request metadata        | Not required                                          | `_meta` version and capabilities required; `MCP-Protocol-Version` and `Mcp-Method` headers required, plus `Mcp-Name` for a call that names a tool, prompt or resource |
| Unknown method              | HTTP 200 carrying a JSON-RPC `-32601`                 | HTTP 404 with `-32601`                                                                                                                                                |
| Unknown tool                | A result with `isError: true`                         | `400` with `-32602`                                                                                                                                                   |
| Response format             | SSE frame, even for one reply                         | Plain JSON (the spec allows either)                                                                                                                                   |
| Notification                | `202` with no body                                    | Not handled yet: answered like a request (see Known gaps in the README)                                                                                               |
| `Accept` and `Content-Type` | Checked by the SDK: `406` and `415`                   | Not checked                                                                                                                                                           |

## 7. Tests

`npm test` runs Vitest. Tests are split by what they need:

- Pure logic with no network: `test/catalog/*` (item input validation, search and the job store), `test/protocol/*` (the type guards, the reply builders and every rule of `validateRequest`) and `test/server-2026/handler.test.ts` (every rejection case, calling `handleRpc` directly).
- End to end over HTTP on a random port: `test/server-2026/http.test.ts`, `test/sdk-server/http.test.ts` and `test/sdk-server/sessions.test.ts` (session mode and the question in the middle of a tool call). They also cover the request log and the misbehaving clients of section 5.

## 8. Exercises

- Add `import { randomUUID } from 'node:crypto';` to `src/sdk-server/http.ts` and change `sessionIdGenerator: undefined` to `sessionIdGenerator: () => randomUUID()`. Restart, and send `initialize`. An `mcp-session-id` response header appears: the header the new revision removed. Then send `tools/list`. It now fails with `400` and `Server not initialized`, because every request builds a new transport, and a transport with sessions expects `initialize` first. Explain what a server with sessions has to keep between requests.
- Predict which code each of these returns, then check: a version header that differs from `_meta`, and a version of `1900-01-01` in both places.
- Start a job, restart the server, then call `get_result` with the returned id. Describe what a production system would store, and where.
- Send the hand-written server a valid request with an extra `Origin: http://evil.example` header. It answers `200`. Read the `Origin` rule in [spec-2026-07-28.md](spec-2026-07-28.md), then add the check and a test for it.
