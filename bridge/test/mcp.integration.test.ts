import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { getSharedDiagnosticsCache } from "../src/diagnostics/cache.js";
import { getSharedHealthCache } from "../src/health/cache.js";
import { getSharedIpcSession } from "../src/ipc/session.js";
import { PulseMcpLogger } from "../src/logging/logger.js";
import { MetricsRegistry } from "../src/metrics/metrics.js";
import { PersonalDataRedactor } from "../src/privacy/redactor.js";
import { createPulseMcpServer } from "../src/server/createServer.js";
import { getSharedTimelineCache } from "../src/timeline/cache.js";

describe("MCP integration (in-memory)", () => {
  it("lists every tool and bridge_status", async () => {
    const session = getSharedIpcSession();
    const health = getSharedHealthCache(session);
    const timeline = getSharedTimelineCache(session);
    const diagnostics = getSharedDiagnosticsCache(session);
    const mcp = createPulseMcpServer({
      metrics: new MetricsRegistry(),
      policy: { enabled: true, redact: true, path: "test-policy.json" },
      logger: new PulseMcpLogger(),
      session,
      health,
      timeline,
      diagnostics,
      redactor: new PersonalDataRedactor(),
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    // Claude Desktop rejects dots: ^[a-zA-Z0-9_-]{1,64}$
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
    expect(names).toContain("bridge_status");
    expect(names).toContain("system_cpu");
    expect(names).toContain("system_health");
    expect(names).toContain("system_network");
    expect(names).toContain("process_list");
    expect(names).toContain("process_search");
    expect(names).toContain("process_details");
    expect(names).toContain("timeline_list");
    expect(names).toContain("timeline_search");
    expect(names).toContain("diagnostics_snapshot");
    expect(names).toContain("service_status");
    expect(names).toContain("report_export");

    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain("pulse://system/cpu");
    expect(uris).toContain("pulse://timeline/live");
    expect(uris).toContain("pulse://diagnostics/snapshot");
    expect(uris).toContain("pulse://bridge/status");

    const self = await client.callTool({ name: "bridge_status", arguments: {} });
    const text = (self.content as Array<{ text?: string }>)[0]?.text ?? "";
    const body = JSON.parse(text) as {
      ok: boolean;
      data: { capabilities: { tools: string[] } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.capabilities.tools).toContain("system_cpu");

    await client.close();
    await mcp.close();
  });

  it("system_cpu returns POLICY_DISABLED when off", async () => {
    const session = getSharedIpcSession();
    const health = getSharedHealthCache(session);
    const timeline = getSharedTimelineCache(session);
    const diagnostics = getSharedDiagnosticsCache(session);
    const mcp = createPulseMcpServer({
      metrics: new MetricsRegistry(),
      policy: { enabled: false, redact: true, path: "test-policy.json" },
      logger: new PulseMcpLogger(),
      session,
      health,
      timeline,
      diagnostics,
      redactor: new PersonalDataRedactor(),
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" });
    await Promise.all([
      mcp.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const result = await client.callTool({
      name: "system_cpu",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    const body = JSON.parse(text) as { code: string };
    expect(body.code).toBe("POLICY_DISABLED");
    await client.close();
    await mcp.close();
  });
});
