/**
 * @file The protocol revision the hand-written server speaks, and the `_meta` keys that carry
 * per-request version, capability and server-identity information. See
 * docs/spec-2026-07-28.md.
 */

/** The protocol revision implemented by the hand-written server. */
export const PROTOCOL_VERSION = '2026-07-28';

/**
 * Every revision the server accepts. A single entry today; a server that also supported an older
 * revision would list it here.
 */
export const SUPPORTED_VERSIONS = [PROTOCOL_VERSION];

/** `_meta` key on every client request: the protocol revision the client is speaking. */
export const META_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

/** `_meta` key on every client request: the capabilities the client declares (`{}` means none). */
export const META_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

/** `_meta` key on a server result: the server's name and version. */
export const META_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
