export type RpcId = string | number | null;

export type RpcBody = {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: {
    _meta?: Record<string, unknown>;
    name?: string;
    uri?: string;
    protocolVersion?: string;
  };
};

export type RpcResponse = {
  status: number;
  body: unknown;
  method?: string;
};

export const ok = (id: RpcId, result: unknown): RpcResponse => ({
  status: 200,
  body: { jsonrpc: '2.0', id, result },
});

export const fail = (
  status: number,
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): RpcResponse => ({
  status,
  body: {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  },
});
