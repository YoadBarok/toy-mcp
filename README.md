# toy-mcp

Two small MCP servers for studying the Model Context Protocol on the wire, and for seeing what changed in the 2026-07-28 revision. Both are short enough to read in an afternoon.

|                     | Entry point        | Port | Protocol                                          | Built with                                     |
| ------------------- | ------------------ | ---- | ------------------------------------------------- | ---------------------------------------------- |
| SDK server          | `src/sdk-server/`  | 3333 | 2025-11-25 (the latest the official SDK supports) | The official TypeScript SDK, in stateless mode |
| Hand-written server | `src/server-2026/` | 3334 | 2026-07-28                                        | Node's `http` module only, built step by step  |

They can run side by side, so the same kind of request can be sent to each and the answers compared.

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm start            # SDK server        http://127.0.0.1:3333/mcp
npm run start:2026   # hand-written one  http://127.0.0.1:3334/mcp
```

Set `PORT` to use another port.

## Project layout

```
src/
  protocol/     JSON-RPC builders, error codes, per-request validation, server/discover (pure functions)
  catalog/      the toy marketplace both servers share: items, input validation, job store
  sdk-server/   the SDK-based server: tool registration and HTTP transport
  server-2026/  the hand-written server: request handler and HTTP transport
test/           Vitest tests, mirroring src/
postman/        a Postman collection with a request for every behavior
docs/           how it works, and the wire shapes of the 2026-07-28 spec
```

The hand-written server keeps its protocol rules in plain functions (`handleRpc`, `validateRequest`) with the HTTP layer kept thin, so the rules can be read and tested without a network.

## Scripts

| Script              | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm test`          | Vitest: unit tests plus end-to-end tests that boot each server on a random port |
| `npm run typecheck` | `tsc -p .`                                                                      |
| `npm run lint`      | ESLint (recommended rules, single quotes)                                       |
| `npm run check`     | typecheck, lint and tests                                                       |

## Trying it

Import `postman/toy-mcp.postman_collection.json` into Postman. It has 19 requests in one folder per server and three collection variables: `sdk`, `s2026` and `jobId`. Start a server first. The hand-written server's folder is lettered A to J, and each name says the status and error code to expect. To call `get_result`, paste a `jobId` from a `start_job` reply into the `jobId` variable.

Plain curl works too, since every call is one JSON-RPC POST. Write the headers out in each command: storing them in a shell variable breaks in zsh, which does not split an unquoted variable into separate arguments.

```bash
curl -X POST 'http://127.0.0.1:3334/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: server/discover' -d '{"jsonrpc":"2.0","id":"d1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Clients that open with `initialize` (including ones built on the 2025 SDK) get `-32022` from the hand-written server, which is the intended behavior for a 2026-only server. Use Postman or curl with it.

## The SDK server

A small marketplace with a catalog of three fake items.

| Tool                          | What it demonstrates                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo`                        | The minimal tool: name, description, JSON-Schema input, typed content result                                                                  |
| `search_catalog`, `call_item` | The marketplace pattern: search, then one generic call. A validation failure names every failing field                                        |
| `start_job`, `get_result`     | A server-minted handle in place of a session. `idempotencyKey` deduplicates retries and `maxCostUsd` is a cost cap checked before work starts |

Behaviors worth knowing:

- The latest SDK (1.32.2) supports protocol 2025-11-25 at most, so it predates 2026-07-28. `server/discover` returns `-32601`.
- Stateless mode: a fresh server per request, no `Mcp-Session-Id`, and `tools/list` works without `initialize`.
- Replies are SSE frames (`event: message`, `data: {...}`) even for a single response.
- Argument-validation failures and unknown tools come back as a normal result with `isError: true`. Unknown methods come back as a JSON-RPC `error`.
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

| Code     | HTTP | Meaning                                                                  | Example trigger                                                                       |
| -------- | ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `-32700` | 400  | Body is not valid JSON                                                   | Body `not json`                                                                       |
| `-32600` | 400  | Not a JSON-RPC request                                                   | Body `null`                                                                           |
| `-32602` | 400  | A required `_meta` field is missing                                      | Headers present, no `_meta`                                                           |
| `-32020` | 400  | The request contradicts itself                                           | Header version differs from `_meta`; `Mcp-Method` or `Mcp-Name` differs from the body |
| `-32022` | 400  | Unsupported protocol version, with `data.supported` and `data.requested` | Version `1900-01-01`, or any `initialize`                                             |
| `-32601` | 404  | Method not found                                                         | Any method not implemented yet                                                        |

The specification does not give an HTTP status for `-32700` and `-32600`, so 400 is this project's choice. The order of the checks, and answering `initialize` with `-32022`, are also implementation choices rather than spec text.

## Documentation

- [docs/how-it-works.md](docs/how-it-works.md): what each part demonstrates, with real responses, and exercises.
- [docs/spec-2026-07-28.md](docs/spec-2026-07-28.md): the wire shapes this project implements, with sources.
- [AGENTS.md](AGENTS.md): guidance for coding agents and contributors.

## License

MIT. See [LICENSE](LICENSE).

## Notes

- TypeScript is pinned to 6.0.x because `typescript-eslint` supports TypeScript below 6.1 only. Raise it when typescript-eslint adds support for 7.
- Formatting: single quotes. `.prettierrc.json` configures Prettier and the ESLint `quotes` rule enforces it.
