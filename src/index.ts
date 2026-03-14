import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";

const CFT_BASE = process.env.CFT_BASE_URL || "https://cft-terminal-hub.vercel.app";
const ADMIN_SECRET = process.env.CFT_ADMIN_SECRET;

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(path: string, opts: RequestInit = {}): Promise<unknown> {
  const url = `${CFT_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_SECRET ? { "x-admin-secret": ADMIN_SECRET } : {}),
      ...((opts.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CFT API ${res.status} at ${path}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "cft-mcp-server--1",
  version: "1.0.0",
});

// ── 1. Health check ───────────────────────────────────────────────────────────
server.registerTool(
  "cft_health",
  {
    title: "CFT Platform Health",
    description: "Check if the CFT platform and its database are healthy. Returns DB status, deal count, and last market data update.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const data = await api("/api/health");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 2. Market prices ──────────────────────────────────────────────────────────
server.registerTool(
  "cft_market_prices",
  {
    title: "CFT Live Market Prices",
    description: "Get current chrome ore market prices: CIF China (CR38/40/42%), FOT Steelpoort rates, ZAR/USD fx rate, and full grade table with deductions breakdown.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const data = await api("/api/market");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 3. List deals ─────────────────────────────────────────────────────────────
server.registerTool(
  "cft_list_deals",
  {
    title: "CFT List Deals",
    description: `List all deals/assays submitted to the CFT platform. Returns grade, tonnage, FOT rate, supplier, location, status, and timestamps.
Useful for: auditing deal flow, checking pending approvals, seeing which suppliers are active.`,
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Max deals to return (default 50, max 200)"),
      status: z.enum(["pending", "approved", "rejected", "all"]).default("all").describe("Filter by deal status"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, status }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status !== "all") params.set("status", status);
    const data = await api(`/api/deals?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 4. Deal stats summary ─────────────────────────────────────────────────────
server.registerTool(
  "cft_deal_stats",
  {
    title: "CFT Deal Statistics",
    description: "Get aggregated deal statistics: total deals, total tonnage, total platform fees collected (R5/ton), average grade, breakdown by location and status. Useful for KPI monitoring.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const data = await api("/api/admin?summary=1") as Record<string, unknown>;
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 5. WhatsApp sessions ──────────────────────────────────────────────────────
server.registerTool(
  "cft_whatsapp_sessions",
  {
    title: "CFT WhatsApp Sessions",
    description: `View active WhatsApp conversation sessions. Shows current step (idle/await_location/await_tonnage/await_deal_type/await_fob_port/calculating), phone number, and session data.
Useful for debugging stuck sessions or seeing who is mid-flow.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const data = await api("/api/admin?sessions=1");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 6. Reset WhatsApp session ─────────────────────────────────────────────────
server.registerTool(
  "cft_reset_whatsapp_session",
  {
    title: "CFT Reset WhatsApp Session",
    description: "Reset a stuck WhatsApp session for a given phone number back to idle state. Use when a supplier is stuck in a conversation flow and can't recover by typing 'reset'.",
    inputSchema: {
      phone: z.string().describe("Phone number in Twilio format e.g. whatsapp:+27676419843"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ phone }) => {
    const data = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "reset_session", phone }),
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 7. Approve / reject deal ──────────────────────────────────────────────────
server.registerTool(
  "cft_update_deal_status",
  {
    title: "CFT Approve or Reject Deal",
    description: "Approve or reject a deal by ID. Approved deals are logged as confirmed. Rejected deals are flagged with reason.",
    inputSchema: {
      dealId: z.string().describe("Deal ID (numeric string from cft_list_deals)"),
      status: z.enum(["approved", "rejected"]).describe("New status for the deal"),
      reason: z.string().optional().describe("Reason for rejection (optional)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ dealId, status, reason }) => {
    const data = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "update_deal", dealId, status, reason }),
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 8. Verify certificate ─────────────────────────────────────────────────────
server.registerTool(
  "cft_verify_certificate",
  {
    title: "CFT Verify QR Certificate",
    description: "Look up a deal's QR-verified certificate by deal ID. Returns the full deal record including grade, FOT rate, tonnage, supplier, and immutable platform fee.",
    inputSchema: {
      dealId: z.string().describe("Deal ID to verify"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ dealId }) => {
    const data = await api(`/api/verify?id=${dealId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 9. Calculate FOT rate ─────────────────────────────────────────────────────
server.registerTool(
  "cft_calculate_fot",
  {
    title: "CFT Calculate FOT Rate",
    description: `Calculate a Reverse-Netback FOT (Free On Truck) rate for chrome ore.
Formula: (CIF_China + grade_adj) × fx - ocean_freight×fx - port_fees×fx - truck_ZAR - R5_platform_fee
Grade adjustments vs CR42% base: 36-38%=−30, 38-40%=−22, 40-42%=−10, 42%+=0`,
    inputSchema: {
      grade: z.number().min(25).max(60).describe("Cr2O3 grade percentage e.g. 38.5"),
      location: z.enum(["steelpoort", "rustenburg", "thabazimbi"]).describe("Mine location — determines truck ZAR/t"),
      tonnage: z.number().positive().optional().describe("Tonnage for deal summary (optional)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ grade, location, tonnage }) => {
    const params = new URLSearchParams({ grade: String(grade), location });
    if (tonnage) params.set("tonnage", String(tonnage));
    const data = await api(`/api/market?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── 10. List suppliers ────────────────────────────────────────────────────────
server.registerTool(
  "cft_list_suppliers",
  {
    title: "CFT List Registered Suppliers",
    description: "List all registered supplier accounts on the CFT platform. Returns name, email, WhatsApp number, mine location, and registration date. Excludes passwords.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50).describe("Max suppliers to return"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit }) => {
    const data = await api(`/api/admin?suppliers=1&limit=${limit}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── HTTP Server (Render.com) ─────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check for Render
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "cft-mcp-server--1", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// MCP endpoint — new transport per request (stateless)
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: req.body?.id ?? null,
      });
    }
  }
});

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, () => {
  console.log(`CFT MCP server running on http://0.0.0.0:${PORT}/mcp`);
});
