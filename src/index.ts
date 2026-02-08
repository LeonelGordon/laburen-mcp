import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// MCP Agent
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Laburen MCP",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"list_products",
			{},
			async () => {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify([
								{ id: 1, name: "Test Product", price: 1000 },
								{ id: 2, name: "Another Product", price: 2500 },
							], null, 2),
						},
					],
				};
			},
		);
	}
}

export interface Env {}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
