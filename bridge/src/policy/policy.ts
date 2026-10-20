import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpPolicy {
  /** Tools answer only when enabled. */
  enabled: boolean;
  /** Mask personal data (user/computer names, SIDs, IPs, MACs, serials). */
  redact: boolean;
  path: string;
}

function defaultPolicyPath(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "PulseBridge", "config.json");
}

function envFlag(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/**
 * Loads the bridge configuration.
 *
 * Precedence per setting:
 * 1. PULSE_BRIDGE_ENABLED / PULSE_BRIDGE_REDACT = true|false
 * 2. PULSE_BRIDGE_CONFIG or %LOCALAPPDATA%\PulseBridge\config.json
 *    `{ "enabled": bool, "redact": bool }`
 * 3. Defaults: enabled=true (the user installed the bridge on purpose),
 *    redact=true (tool output usually goes to a cloud model).
 */
export function loadPolicy(
  policyPath = process.env.PULSE_BRIDGE_CONFIG ?? defaultPolicyPath(),
): McpPolicy {
  let file: { enabled?: unknown; redact?: unknown } = {};
  try {
    if (fs.existsSync(policyPath)) {
      file = JSON.parse(fs.readFileSync(policyPath, "utf8")) as typeof file;
    }
  } catch {
    // Unreadable config: keep defaults.
  }
  return {
    enabled:
      envFlag("PULSE_BRIDGE_ENABLED") ??
      (typeof file.enabled === "boolean" ? file.enabled : true),
    redact:
      envFlag("PULSE_BRIDGE_REDACT") ??
      (typeof file.redact === "boolean" ? file.redact : true),
    path: policyPath,
  };
}

export function writePolicy(
  settings: { enabled: boolean; redact?: boolean },
  policyPath: string,
): void {
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(
    policyPath,
    `${JSON.stringify(
      {
        enabled: settings.enabled,
        redact: settings.redact ?? true,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
