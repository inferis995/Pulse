import type { DiagnosticsCache } from "../diagnostics/cache.js";
import type { HealthCache } from "../health/cache.js";
import type { PulseMcpLogger } from "../logging/logger.js";
import type { MetricsRegistry } from "../metrics/metrics.js";
import type { McpPolicy } from "../policy/policy.js";
import type { PersonalDataRedactor } from "../privacy/redactor.js";
import { ReportExportError } from "../report/errors.js";
import {
  failure,
  success,
  toMcpToolResult,
  type ToolErrorCode,
} from "../response/envelope.js";
import { PulseIpcError, type IpcSession } from "../ipc/session.js";
import type { TimelineCache } from "../timeline/cache.js";
import {
  IPC_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
} from "../version.js";

export interface ToolRuntime {
  metrics: MetricsRegistry;
  policy: McpPolicy;
  logger: PulseMcpLogger;
  session: IpcSession;
  health: HealthCache;
  timeline: TimelineCache;
  diagnostics: DiagnosticsCache;
  /** Applied to every tool result when policy.redact is on. */
  redactor: PersonalDataRedactor;
}

/** Tool / resource payload as it leaves the bridge. */
export function presentPayload(ctx: ToolRuntime, data: unknown): unknown {
  return ctx.policy.redact ? ctx.redactor.redactJson(data) : data;
}

export async function runObservationTool(
  ctx: ToolRuntime,
  tool: string,
  work: () => Promise<unknown>,
) {
  const started = Date.now();
  let ipcLatencyMs: number | null = null;

  if (!ctx.policy.enabled) {
    const body = failure(
      tool,
      "POLICY_DISABLED",
      "Pulse Bridge is disabled. Set \"enabled\": true in its config.json, or PULSE_BRIDGE_ENABLED=true.",
      { policyPath: ctx.policy.path },
    );
    ctx.metrics.recordFailure(tool, Date.now() - started, "POLICY_DISABLED");
    ctx.logger.warn("tool.fail", {
      tool,
      code: "POLICY_DISABLED",
      latencyMs: Date.now() - started,
    });
    return toMcpToolResult(body);
  }

  try {
    const ipcStarted = Date.now();
    const data = presentPayload(ctx, await work());
    ipcLatencyMs = Date.now() - ipcStarted;
    const latencyMs = Date.now() - started;
    const body = success(tool, data, {
      observedAt:
        typeof data === "object" &&
        data !== null &&
        "observedAt" in data &&
        typeof (data as { observedAt?: unknown }).observedAt === "string"
          ? (data as { observedAt: string }).observedAt
          : undefined,
      mcpVersion: MCP_SERVER_VERSION,
      ipcProtocolVersion: IPC_PROTOCOL_VERSION,
      serviceVersion: ctx.session.lastServiceVersion,
    });
    ctx.metrics.recordSuccess(tool, latencyMs, ipcLatencyMs);
    ctx.logger.info("tool.ok", {
      tool,
      latencyMs,
      ipcLatencyMs,
      success: true,
    });
    return toMcpToolResult(body);
  } catch (err) {
    const latencyMs = Date.now() - started;
    const mapped = mapError(err);
    const body = failure(tool, mapped.code, mapped.message, mapped.details);
    ctx.metrics.recordFailure(tool, latencyMs, mapped.code, ipcLatencyMs);
    ctx.logger.warn("tool.fail", {
      tool,
      code: mapped.code,
      latencyMs,
      ipcLatencyMs,
      message: mapped.message,
    });
    return toMcpToolResult(body);
  }
}

function mapError(err: unknown): {
  code: ToolErrorCode;
  message: string;
  details: Record<string, unknown>;
} {
  if (err instanceof ReportExportError) {
    return {
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  if (err instanceof PulseIpcError) {
    const allowed: ToolErrorCode[] = [
      "SERVICE_UNAVAILABLE",
      "TIMEOUT",
      "PROCESS_NOT_FOUND",
      "INVALID_ARGUMENT",
      "ACCESS_DENIED",
      "NOT_SUPPORTED",
    ];
    const code: ToolErrorCode = allowed.includes(err.code as ToolErrorCode)
      ? (err.code as ToolErrorCode)
      : "INTERNAL_ERROR";
    return { code, message: err.message, details: {} };
  }
  return {
    code: "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : String(err),
    details: {},
  };
}
