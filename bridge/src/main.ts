#!/usr/bin/env node
/**
 * Pulse Bridge stdio entry — MCP server over the PulseService named pipe.
 * Logs go to stderr / JSONL only; stdout is reserved for MCP messages.
 *
 * Usage:
 *   pulse-bridge                       MCP stdio server (what AI clients launch)
 *   pulse-bridge --print-config <app>  Config snippet for opencode, claude-desktop,
 *                                      claude-code, cursor or vscode
 *   pulse-bridge --version | --help
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { printClientConfig, CLIENT_CONFIG_TARGETS } from "./cli/clientConfig.js";
import { getSharedDiagnosticsCache } from "./diagnostics/cache.js";
import { getSharedHealthCache } from "./health/cache.js";
import { getSharedIpcSession } from "./ipc/session.js";
import { PulseMcpLogger } from "./logging/logger.js";
import { MetricsRegistry } from "./metrics/metrics.js";
import { loadPolicy } from "./policy/policy.js";
import { PersonalDataRedactor } from "./privacy/redactor.js";
import { createPulseMcpServer } from "./server/createServer.js";
import { getSharedTimelineCache } from "./timeline/cache.js";
import { MCP_SERVER_VERSION } from "./version.js";

const HELP = `Pulse Bridge ${MCP_SERVER_VERSION}
MCP server that lets AI apps read Pulse diagnostics (read-only).

Usage:
  pulse-bridge                        Run the MCP server on stdio
  pulse-bridge --print-config <app>   Print the config to add to an AI app
                                      (${CLIENT_CONFIG_TARGETS.join(", ")})
  pulse-bridge --version              Print the version
  pulse-bridge --help                 Print this help

Environment:
  PULSE_BRIDGE_ENABLED=true|false     Turn the tools on or off
  PULSE_BRIDGE_REDACT=true|false      Mask personal data (default: true)
  PULSE_BRIDGE_CONFIG=<file>          Config file (default: %LOCALAPPDATA%\\PulseBridge\\config.json)
  PULSE_BRIDGE_LOG_DIR=<dir>          Log folder (default: %LOCALAPPDATA%\\PulseBridge\\logs)
`;

async function runStdioServer(): Promise<void> {
  const logger = new PulseMcpLogger();
  const metrics = new MetricsRegistry();
  const policy = loadPolicy();
  const session = getSharedIpcSession();
  const health = getSharedHealthCache(session);
  const timeline = getSharedTimelineCache(session);
  const diagnostics = getSharedDiagnosticsCache(session);

  logger.info("Pulse Bridge starting", {
    version: MCP_SERVER_VERSION,
    policyEnabled: policy.enabled,
    redact: policy.redact,
    policyPath: policy.path,
    logPath: logger.logPath,
  });

  if (!policy.enabled) {
    logger.warn("Bridge disabled — tools return POLICY_DISABLED until enabled", {
      policyPath: policy.path,
    });
  }

  const server = createPulseMcpServer({
    metrics,
    policy,
    logger,
    session,
    health,
    timeline,
    diagnostics,
    redactor: PersonalDataRedactor.forThisPc(),
  });
  metrics.connectedClients = 1;

  // Release the pipe slot as soon as the AI app goes away: PulseService
  // accepts only a few clients and the Pulse app needs one.
  const shutdown = (reason: string) => {
    logger.info("Pulse Bridge stopping", { reason });
    void session.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", () => shutdown("stdin closed"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await server.connect(new StdioServerTransport());
  logger.info("Pulse Bridge listening on stdio");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return;
  }
  const printAt = argv.indexOf("--print-config");
  if (printAt >= 0) {
    const entry = path.resolve(fileURLToPath(import.meta.url));
    process.exitCode = printClientConfig(argv[printAt + 1], entry);
    return;
  }
  await runStdioServer();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      message: "Pulse Bridge fatal",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
