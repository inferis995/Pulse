import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPolicy, writePolicy } from "../src/policy/policy.js";

describe("policy", () => {
  const keys = ["PULSE_BRIDGE_ENABLED", "PULSE_BRIDGE_REDACT"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const tmp = () =>
    path.join(os.tmpdir(), `pulse-bridge-config-${Date.now()}-${Math.random()}.json`);

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("defaults to enabled with redaction when the file is missing", () => {
    for (const k of keys) delete process.env[k];
    const policy = loadPolicy(tmp());
    expect(policy.enabled).toBe(true);
    expect(policy.redact).toBe(true);
  });

  it("reads settings from file", () => {
    for (const k of keys) delete process.env[k];
    const p = tmp();
    writePolicy({ enabled: false, redact: false }, p);
    expect(loadPolicy(p)).toMatchObject({ enabled: false, redact: false });
    fs.unlinkSync(p);
  });

  it("env overrides file", () => {
    const p = tmp();
    writePolicy({ enabled: false, redact: true }, p);
    process.env.PULSE_BRIDGE_ENABLED = "true";
    process.env.PULSE_BRIDGE_REDACT = "0";
    expect(loadPolicy(p)).toMatchObject({ enabled: true, redact: false });
    fs.unlinkSync(p);
  });

  it("ignores a corrupt file", () => {
    for (const k of keys) delete process.env[k];
    const p = tmp();
    fs.writeFileSync(p, "{not json", "utf8");
    expect(loadPolicy(p)).toMatchObject({ enabled: true, redact: true });
    fs.unlinkSync(p);
  });
});
