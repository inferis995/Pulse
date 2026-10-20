import { describe, expect, it } from "vitest";

import {
  CLIENT_CONFIG_TARGETS,
  SERVER_KEY,
  clientConfig,
} from "../src/cli/clientConfig.js";

const NODE = String.raw`C:\Program Files\nodejs\node.exe`;
const ENTRY = String.raw`C:\Tools\Pulse\bridge\dist\main.js`;

describe("client config snippets", () => {
  it("never uses the server key old Pulse builds clean up", () => {
    expect(SERVER_KEY).not.toBe("pulse");
  });

  it("OpenCode uses a local command array", () => {
    const cfg = JSON.parse(clientConfig("opencode", ENTRY, NODE).text);
    expect(cfg.mcp[SERVER_KEY]).toEqual({
      type: "local",
      command: [NODE, ENTRY],
      enabled: true,
    });
  });

  it("Claude Desktop and Cursor use mcpServers", () => {
    for (const target of ["claude-desktop", "cursor"] as const) {
      const cfg = JSON.parse(clientConfig(target, ENTRY, NODE).text);
      expect(cfg.mcpServers[SERVER_KEY]).toEqual({ command: NODE, args: [ENTRY] });
    }
  });

  it("VS Code uses servers with stdio type", () => {
    const cfg = JSON.parse(clientConfig("vscode", ENTRY, NODE).text);
    expect(cfg.servers[SERVER_KEY]).toEqual({
      type: "stdio",
      command: NODE,
      args: [ENTRY],
    });
  });

  it("Claude Code quotes paths with spaces", () => {
    expect(clientConfig("claude-code", ENTRY, NODE).text).toBe(
      `claude mcp add --scope user ${SERVER_KEY} -- "${NODE}" ${ENTRY}\n`,
    );
  });

  it("covers every advertised target", () => {
    for (const t of CLIENT_CONFIG_TARGETS) {
      expect(clientConfig(t, ENTRY, NODE).text.length).toBeGreaterThan(0);
    }
  });
});
