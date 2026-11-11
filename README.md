# toy-mcp

Two small MCP servers for studying the Model Context Protocol on the wire, and for seeing what changed in the 2026-07-28 revision. Both are short enough to read in an afternoon.

[MCP](https://modelcontextprotocol.io) is an open protocol that lets an AI application call tools and read data that a server offers. The messages are JSON-RPC 2.0, and here they travel over HTTP.

|                     | Code               | Port | Protocol                                                     | Built with                                                  |
| ------------------- | ------------------ | ---- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| SDK server          | `src/sdk-server/`  | 3333 | 2025-11-25 (the latest that v1 of the official SDK supports) | Version 1 of the official TypeScript SDK, in stateless mode |
| Hand-written server | `src/server-2026/` | 3334 | 2026-07-28                                                   | Node's `http` module only, built step by step               |

They can run side by side, so the same kind of request can be sent to each and the answers compared.

This is a learning project. Neither server is meant for production: see [Known gaps](#known-gaps).

## Quick start

Requires Node 20.19+, 22.13+ or 24+.

```bash
npm install
```

Then start each server in its own terminal:

```bash
npm start            # SDK server           http://127.0.0.1:3333/mcp
```

```bash
npm run start:2026   # hand-written server  http://127.0.0.1:3334/mcp
```

Both listen on `127.0.0.1` only. Set `PORT` to use another port, for example `PORT=4000 npm start`.

Each server prints one line per request. This is the hand-written server after one valid request and one request without the MCP headers:

```
2026-07-28 server on http://127.0.0.1:3334/mcp
server/discover -> 200
server/discover -> 400 -32020 Header mismatch: MCP-Protocol-Version header is missing
```

To send requests, see [Try it](#try-it).

## Where to start reading

The whole of `src/` is about 840 lines, comments included.

1. This README, then [docs/how-it-works.md](docs/how-it-works.md), which walks through both servers with the responses they return.
2. `src/sdk-server/`: `server.ts` registers the tools and `http.ts` is the HTTP transport.
3. `src/server-2026/handler.ts`, then the functions in `src/protocol/` that it calls.
4. `test/`: the test names list the behaviors, one per line.
5. [docs/spec-2026-07-28.md](docs/spec-2026-07-28.md): the parts of the specification that the hand-written server implements, with sources.

## Project layout

```
src/
  protocol/     JSON-RPC types, type guards and reply builders, error codes, per-request validation, server/discover (pure functions)
  catalog/      the toy marketplace behind the SDK server's tools: items, input validation, job store
  sdk-server/   the SDK-based server: tool registration and HTTP transport
  server-2026/  the hand-written server: request handler and HTTP transport
test/           Vitest tests, mirroring src/
postman/        a Postman collection: ready-made requests for both servers
docs/           how it works, and the wire shapes of the 2026-07-28 spec
```

The hand-written server keeps its protocol rules in plain functions (`handleRpc`, `validateRequest`) with the HTTP layer kept thin, so the rules can be read and tested without a network. It does not use `catalog/` yet: its tools arrive in step 3.

## Scripts

| Script                 | What it does                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`             | Vitest: unit tests plus end-to-end tests that boot each server on a random port                                                            |
| `npm run typecheck`    | `tsc -p .`                                                                                                                                 |
| `npm run lint`         | ESLint: recommended rules, single quotes, a TSDoc comment on every exported symbol in `src/`, and no SDK import in the hand-written server |
| `npm run format`       | Prettier: rewrite files to the project style                                                                                               |
| `npm run format:check` | Prettier: report files that differ from the project style, without changing them                                                           |
| `npm run check`        | typecheck, lint, formatting check and tests                                                                                                |

## Try it

### Postman

`postman/toy-mcp.postman_collection.json` is a Postman collection (v2.1) with 24 requests, in one folder per server. Every request has a description that says what it demonstrates and what to look for in the reply.

1. Start the server you want to try (see [Quick start](#quick-start)).
2. In Postman, select **Import** and choose the file. The collection needs no environment and no authorization.
3. Open the folder of that server and send its requests from top to bottom.

| Folder                                            | Start the server with | URL variable | Default value               |
| ------------------------------------------------- | --------------------- | ------------ | --------------------------- |
| `SDK server :3333 (protocol 2025-11-25)`          | `npm start`           | `sdk`        | `http://127.0.0.1:3333/mcp` |
| `Hand-written server :3334 (protocol 2026-07-28)` | `npm run start:2026`  | `s2026`      | `http://127.0.0.1:3334/mcp` |

`sdk` and `s2026` are collection variables that hold the whole URL. If you started a server with another `PORT`, change the port in its variable (open the collection, then its **Variables** tab).

The SDK server answers every request in its folder with HTTP 200 and an SSE frame: the JSON-RPC message is on the `data:` line. The hand-written server's requests are lettered A to L. A succeeds. B to L are each answered with an error, and the name says the HTTP status and, where there is one, the JSON-RPC error code to expect.

`get_result` reads the third collection variable, `jobId`. A script on the `start_job` request stores the `jobId` from the reply in that variable. If `get_result` answers `No job`, copy the `jobId` from the `text` field of the `start_job` reply and paste it into the variable.

### curl

Every call is one JSON-RPC POST, so plain curl works too. Write each header out in full.

The hand-written server:

```bash
curl -X POST 'http://127.0.0.1:3334/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: server/discover' -d '{"jsonrpc":"2.0","id":"d1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

It replies with one line of JSON, shown here on several lines:

```json
{
  "jsonrpc": "2.0",
  "id": "d1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": {},
    "_meta": {
      "io.modelcontextprotocol/serverInfo": { "name": "toy-marketplace-2026", "version": "0.1.0" }
    },
    "instructions": "Hand-written MCP server for the 2026-07-28 revision.",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

The SDK server:

```bash
curl -X POST 'http://127.0.0.1:3333/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The SDK server needs the `Accept` header shown here. curl's default, `Accept: */*`, is answered with `406`.

A client that opens with `initialize` (any client written for an earlier revision, including one built on v1 of the SDK) gets `-32022` and the supported versions from the hand-written server. That is the intended behavior of a server that speaks 2026-07-28 only. Until step 3 adds tools, Postman and curl are the way to talk to it.

## The SDK server

A small marketplace with a catalog of three fake items.

| Tool                          | What it demonstrates                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo`                        | The minimal tool: name, description, JSON-Schema input, typed content result                                                                  |
| `search_catalog`, `call_item` | The marketplace pattern: search, then one generic call. A validation failure names every failing field                                        |
| `start_job`, `get_result`     | A server-minted handle in place of a session. `idempotencyKey` deduplicates retries and `maxCostUsd` is a cost cap checked before work starts |

Behaviors worth knowing:

- It is built on v1 of the official TypeScript SDK (the `@modelcontextprotocol/sdk` package), which supports protocol 2025-11-25 at most, so `server/discover` returns `-32601`. Version 2 of the SDK (the `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages) implements the 2026-07-28 revision. This project does not use it: the second server is written by hand, so that every rule of the 2026-07-28 wire format is visible in the code.
- Stateless mode: a fresh server per request, no `Mcp-Session-Id`, and `tools/list` works without `initialize`.
- Replies are SSE frames (`event: message`, `data: {...}`) even for a single response.
- Argument-validation failures and unknown tools come back as a normal result with `isError: true`. Unknown methods come back as a JSON-RPC `error`.
- The SDK's transport refuses some requests before any tool runs: `406` unless `Accept` lists both `application/json` and `text/event-stream`, `415` unless `Content-Type` is `application/json`, `400` for an `MCP-Protocol-Version` header that names a version it does not support (such as `2026-07-28`), and `400` with `-32700` for a body that is JSON but not a JSON-RPC message. It acknowledges a notification with `202` and no body.
- Jobs live in memory, so a restart loses them. A real deployment needs a shared store.

## The hand-written server

Built one step at a time; each step is runnable and each rejection is visible in the server log.

| Step | What it adds                                                                                        | Status  |
| ---- | --------------------------------------------------------------------------------------------------- | ------- |
| 1    | JSON-RPC envelope, `server/discover`, `404` with `-32601` for removed or unknown methods            | Done    |
| 2    | Per-request rules: required headers, required `_meta`, version check, `initialize` from old clients | Done    |
| 3    | `tools/list` and `tools/call` with `resultType`, plus `ttlMs` and `cacheScope` on the list          | Planned |
| 4    | The handle, idempotency and cost-cap tools from the SDK server                                      | Planned |
| 5    | Multi round-trip requests: `input_required`, `requestState` and `inputResponses`                    | Planned |

Errors it returns today:

| Code     | HTTP | Meaning                                                                                  | Example trigger                                                                                                  |
| -------- | ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `-32700` | 400  | Body is not valid JSON                                                                   | Body `not json`                                                                                                  |
| `-32600` | 400  | Not a JSON-RPC 2.0 request; answered with `id: null`                                     | Body `null`; a `method` that is not a string; an `id` that is not a string, a number or `null`                   |
| `-32020` | 400  | A required header is missing, or a header contradicts the body                           | No `MCP-Protocol-Version`; header version differs from `_meta`; `Mcp-Method` or `Mcp-Name` differs from the body |
| `-32602` | 400  | `_meta` does not carry a protocol version (a string) and client capabilities (an object) | Headers present, no `_meta`                                                                                      |
| `-32022` | 400  | Unsupported protocol version, with `data.supported` and `data.requested`                 | Version `1900-01-01`, or any `initialize`                                                                        |
| `-32601` | 404  | Method not found                                                                         | Any method not implemented yet                                                                                   |

Outside JSON-RPC, a path other than `/mcp` gets `404`, and a method other than `POST` on `/mcp` gets `405` with `Allow: POST`. Both have an empty body.

The server does not return `-32021` (MissingRequiredClientCapability) yet, because nothing it implements needs a client capability. Step 5 changes that.

The specification does not give an HTTP status for `-32700` and `-32600`, so 400 is this project's choice. The order of the checks, and answering `initialize` with `-32022`, are also implementation choices rather than spec text.

## Known gaps

Both servers are for learning on a local machine. These things are missing, some on purpose and some because they are not built yet:

- **No authentication or authorization.** Anyone who can reach the port can call every tool.
- **No `Origin` check.** The specification requires an HTTP server to validate the `Origin` header and to answer an invalid one with `403`, as a defense against DNS rebinding. Neither server does. Both bind to `127.0.0.1` only.
- **No limit on the size of a request body**, on either server.
- **The path must be exactly `/mcp`.** `/mcp/` and `/mcp?x=1` get `404` from both servers.
- **The hand-written server answers a notification as if it were a request.** A message without an `id` gets `200` and a reply with `id: null`. The specification asks for `202` and no body.
- **The hand-written server does not check `Accept` or `Content-Type`.**
- **`start_job` compares only the idempotency key.** A second call with the same key and different arguments returns the first job. A production API would refuse it.
- **The cost cap is checked only before a job starts**, and jobs live in memory.

## Documentation

- [docs/how-it-works.md](docs/how-it-works.md): what each part demonstrates, with real responses, and exercises.
- [docs/spec-2026-07-28.md](docs/spec-2026-07-28.md): the wire shapes this project implements, with sources.
- [AGENTS.md](AGENTS.md): guidance for coding agents and contributors.

## License

MIT. See [LICENSE](LICENSE).

## Notes

- TypeScript is pinned to 6.0.x because `typescript-eslint` supports TypeScript below 6.1 only. Raise it when typescript-eslint supports a newer release.
- Formatting: single quotes. `.prettierrc.json` configures Prettier and the ESLint `quotes` rule enforces it.
