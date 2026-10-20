/** Pulse Bridge version. */
export const MCP_SERVER_VERSION = "1.0.0";

/** MCP protocol version advertised to clients (spec family). */
export const MCP_PROTOCOL_VERSION = "2025-03-26";

/**
 * Pulse releases this bridge was checked against (major.minor).
 * A newer PulseService still works when its protocol only adds fields;
 * bridge_status reports it as "untested" so the user knows to check.
 */
export const PULSE_TESTED_VERSIONS = ["1.5"] as const;

/** Pulse named-pipe IPC protocol version. */
export const IPC_PROTOCOL_VERSION = 1;

export const PIPE_NAME = "\\\\.\\pipe\\PulseService";

export const CLIENT_NAME = "PulseBridge";

/** "tested" | "untested" | "unknown" for a PulseService version string. */
export function pulseCompatibility(
  serviceVersion: string | null | undefined,
): "tested" | "untested" | "unknown" {
  const m = /^(\d+)\.(\d+)/.exec(serviceVersion ?? "");
  if (!m) return "unknown";
  const majorMinor = `${m[1]}.${m[2]}`;
  return (PULSE_TESTED_VERSIONS as readonly string[]).includes(majorMinor)
    ? "tested"
    : "untested";
}
