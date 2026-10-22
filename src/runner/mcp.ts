// The kix tools an agent reports through, served as a minimal MCP server over
// streamable HTTP on localhost. Each attempt gets its own server and bearer
// token, so only that attempt's agent can call them. Replies are plain JSON;
// the server never opens an event stream.
import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface Tool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** The tool's reply to the agent. Throwing reports the message as a tool error it can act on. */
	call(args: Record<string, unknown>): Promise<string>;
}

export interface ToolServer {
	url: string;
	token: string;
	close(): Promise<void>;
}

/** The newest MCP revision this server speaks; it answers an older client in that client's revision. */
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 4 * 1024 * 1024;

type Request = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function body(request: IncomingMessage): Promise<string> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		size += (chunk as Buffer).length;
		if (size > BODY_LIMIT) throw new Error("Request too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function answer(tools: Tool[], message: Request): Promise<unknown> {
	const params = message.params ?? {};
	switch (message.method) {
		case "initialize":
			return {
				protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
				capabilities: { tools: {} },
				serverInfo: { name: "kix", version: "1" },
			};
		case "ping":
			return {};
		case "tools/list":
			return {
				tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
			};
		case "tools/call": {
			const tool = tools.find((t) => t.name === params.name);
			if (!tool) throw Object.assign(new Error(`Unknown tool ${String(params.name)}`), { code: -32602 });
			const args = (params.arguments ?? {}) as Record<string, unknown>;
			try {
				return { content: [{ type: "text", text: await tool.call(args) }] };
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					isError: true,
				};
			}
		}
		default:
			throw Object.assign(new Error(`Unknown method ${String(message.method)}`), { code: -32601 });
	}
}

async function handle(tools: Tool[], token: string, request: IncomingMessage, response: ServerResponse) {
	if (request.headers.authorization !== `Bearer ${token}`) {
		response.writeHead(401).end();
		return;
	}
	if (request.method !== "POST") {
		// No server-initiated stream: the client falls back to request replies.
		response.writeHead(405, { Allow: "POST" }).end();
		return;
	}
	let parsed: Request | Request[];
	try {
		parsed = JSON.parse(await body(request));
	} catch {
		response.writeHead(400, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
		return;
	}
	const batch = Array.isArray(parsed) ? parsed : [parsed];
	const replies = [];
	for (const message of batch) {
		// Notifications and client responses need no reply.
		if (message.id === undefined || message.id === null || message.method === undefined) continue;
		try {
			replies.push({ jsonrpc: "2.0", id: message.id, result: await answer(tools, message) });
		} catch (error) {
			const code = (error as { code?: number }).code ?? -32603;
			replies.push({ jsonrpc: "2.0", id: message.id, error: { code, message: (error as Error).message } });
		}
	}
	if (replies.length === 0) {
		response.writeHead(202).end();
		return;
	}
	response.writeHead(200, { "Content-Type": "application/json" });
	response.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
}

/** Serve `tools` on a random localhost port until closed. */
export async function serveTools(tools: Tool[]): Promise<ToolServer> {
	const token = randomBytes(32).toString("base64url");
	const server = createServer((request, response) => {
		handle(tools, token, request, response).catch(() => {
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		token,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			}),
	};
}
