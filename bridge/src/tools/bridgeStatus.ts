import type { MetricsRegistry } from "../metrics/metrics.js";
import type { McpPolicy } from "../policy/policy.js";
import { failure, success, toMcpToolResult } from "../response/envelope.js";
import {
  INVENTORY_TOOLS_REGISTERED,
  V1_PERMISSIONS,
  V1_PROTOCOL_FEATURES,
  V1_REPORT_FORMATS,
  V1_RESOURCES,
  V1_SUBSCRIPTIONS,
  V1_TOOLS,
  V1_TOOL_NAMESPACES,
} from "../catalog/v1.js";
import type { IpcSession } from "../ipc/session.js";
import type { PersonalDataRedactor } from "../privacy/redactor.js";
import {
  IPC_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  PULSE_TESTED_VERSIONS,
  pulseCompatibility,
} from "../version.js";

export interface BridgeStatusContext {
  /** Masks the user name in log / config paths when policy.redact is on. */
  redactor?: PersonalDataRedactor;
  metrics: MetricsRegistry;
  policy: McpPolicy;
  logPath: string;
  transport: "stdio";
  session: IpcSession;
  activeSubscriptions: string[];
}

/** Shared status payload for bridge_status and pulse://bridge/status. */
export async function buildMcpStatus(
  ctx: BridgeStatusContext,
): Promise<{ observedAt: string; data: Record<string, unknown>; ipcLatencyMs: number }> {
  let ipcError: string | null = null;
  const ipcStarted = Date.now();
  try {
    await ctx.session.ensureConnected();
  } catch (err) {
    ipcError = err instanceof Error ? err.message : String(err);
  }
  const ipcLatencyMs = Date.now() - ipcStarted;

  const metrics = ctx.metrics.snapshot();
  const observedAt = new Date().toISOString();
  const connected = ctx.session.connected;

  const data = {
    observedAt,
    enabledPolicy: ctx.policy.enabled,
    redactPersonalData: ctx.policy.redact,
    uptimeSeconds: metrics.uptimeSeconds,
    transport: ctx.transport,
    versions: {
      mcpProtocol: MCP_PROTOCOL_VERSION,
      mcpServer: MCP_SERVER_VERSION,
      pulseService: ctx.session.lastServiceVersion,
      pulseTested: [...PULSE_TESTED_VERSIONS],
      ipcProtocol: IPC_PROTOCOL_VERSION,
    },
    pulseCompatibility: pulseCompatibility(ctx.session.lastServiceVersion),
    namespaces: [...V1_TOOL_NAMESPACES],
    capabilities: {
      tools: [...V1_TOOLS],
      resources: [...V1_RESOURCES],
      subscriptions: [...V1_SUBSCRIPTIONS],
      reportFormats: [...V1_REPORT_FORMATS],
      permissions: [...V1_PERMISSIONS],
      protocolFeatures: [...V1_PROTOCOL_FEATURES],
      inventoryToolsRegistered: [...INVENTORY_TOOLS_REGISTERED],
      inventoryToolsEnabled: false,
    },
    connectedClients: Math.max(1, metrics.connectedClients),
    requestsServed: metrics.requestsServed,
    requestsFailed: metrics.requestsFailed,
    averageLatencyMs: metrics.averageLatencyMs,
    averageIpcLatencyMs: metrics.averageIpcLatencyMs,
    lastRequestAt: metrics.lastRequestAt,
    lastRequestTool: metrics.lastRequestTool,
    lastFailureReason: metrics.lastFailureReason,
    activeTools: [...V1_TOOLS],
    activeSubscriptions: ctx.activeSubscriptions,
    logPath: ctx.logPath,
    servicePipeConnected: connected,
    diagnostics: {
      startedAt: metrics.startedAt,
      pid: process.pid,
      policyPath: ctx.policy.path,
      ipcError,
      ipcLatencyMs,
    },
  };

  return { observedAt, data, ipcLatencyMs };
}

export async function runBridgeStatus(ctx: BridgeStatusContext) {
  const tool = "bridge_status";
  const started = Date.now();

  if (!ctx.policy.enabled) {
    const body = failure(
      tool,
      "POLICY_DISABLED",
      "Pulse Bridge is disabled. Set \"enabled\": true in its config.json, or PULSE_BRIDGE_ENABLED=true.",
      { policyPath: ctx.policy.path },
    );
    ctx.metrics.recordFailure(tool, Date.now() - started, "POLICY_DISABLED");
    return toMcpToolResult(body);
  }

  const { observedAt, data, ipcLatencyMs } = await buildMcpStatus(ctx);
  const shown =
    ctx.policy.redact && ctx.redactor ? ctx.redactor.redactJson(data) : data;
  const body = success(tool, shown, {
    observedAt,
    mcpVersion: MCP_SERVER_VERSION,
    ipcProtocolVersion: IPC_PROTOCOL_VERSION,
    serviceVersion: ctx.session.lastServiceVersion,
  });
  ctx.metrics.recordSuccess(tool, Date.now() - started, ipcLatencyMs);
  return toMcpToolResult(body);
}
