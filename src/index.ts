import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const CFT_BASE = process.env.CFT_BASE_URL || "https://cft-terminal-hub.vercel.app";
const ADMIN_SECRET = process.env.CFT_ADMIN_SECRET || "";

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const url = `${CFT_BASE}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };

  if (ADMIN_SECRET) headers["x-admin-secret"] = ADMIN_SECRET;

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`CFT API ${res.status} at ${path}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createServer() {
  const server = new McpServer({ name: "mcp-server", version: "1.0.0" });

  server.registerTool(
    "cft_health",
    {
      title: "CFT Platform Health",
      description: "Check if the CFT platform is healthy.",
      inputSchema: {},
    },
    async () => {
      const data = await api("/api/health");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "cft_market_prices",
    {
      title: "CFT Market Prices",
      description: "Get chrome ore market prices.",
      inputSchema: {},
    },
    async () => {
      const data = await api("/api/market");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "cft_verify_certificate",
    {
      title: "Verify QR Certificate",
      description: "Verify deal certificate.",
      inputSchema: { dealId: z.string() },
    },
    async ({ dealId }) => {
      const data = await api(`/api/verify?id=${dealId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "mcp-server", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.post("/mcp", async (req, res) => {
  try {
    const server = createServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "MCP server error", message: err.message });
  }
});

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MCP server running on port ${PORT}`);
});
