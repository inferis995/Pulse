import { describe, expect, it } from "vitest";

import { PersonalDataRedactor } from "../src/privacy/redactor.js";
import { presentPayload, type ToolRuntime } from "../src/tools/runTool.js";

describe("PersonalDataRedactor", () => {
  const r = new PersonalDataRedactor({
    userNames: ["mario"],
    computerNames: ["UFFICIO-PC", "UFFICIO-PC-2"],
    secrets: ["S3R1AL-XYZ", "To be filled by O.E.M."],
  });

  it("masks profile paths, user and computer names as whole words", () => {
    expect(r.redact(String.raw`C:\Users\Mario\AppData\app.exe`)).toBe(
      String.raw`C:\Users\[user]\AppData\app.exe`,
    );
    expect(r.redact("Logon of mario on UFFICIO-PC-2")).toBe(
      "Logon of [user] on [computer]",
    );
    expect(r.redact("marioni is another word")).toBe("marioni is another word");
  });

  it("keeps shared profile folders", () => {
    expect(r.redact(String.raw`C:\Users\Public\Desktop`)).toBe(
      String.raw`C:\Users\Public\Desktop`,
    );
  });

  it("masks SIDs, e-mail, MAC and IPv4 but keeps loopback and versions", () => {
    expect(
      r.redact(
        "S-1-5-21-1111-2222-3333-1001 a@b.it 00:1A:2B:3C:4D:5E 192.168.1.20 127.0.0.1 10.0.22631.4317",
      ),
    ).toBe(
      "S-1-5-21-[sid] [email] [mac] [ip] 127.0.0.1 10.0.22631.4317",
    );
    expect(r.redact("S-1-5-18")).toBe("S-1-5-18");
  });

  it("masks given secrets but not firmware placeholders", () => {
    expect(r.redact("serial S3R1AL-XYZ")).toBe("serial [serial]");
    expect(r.redact("To be filled by O.E.M.")).toBe("To be filled by O.E.M.");
  });

  it("walks JSON and masks by key", () => {
    const out = r.redactJson({
      user: String.raw`UFFICIO-PC\mario`,
      ipv6: "fe80::1, ::1",
      gateway: "192.168.1.1",
      macAddress: "00-1A-2B-3C-4D-5E",
      serialNumber: "ABCD1234",
      biosSerial: "Default string",
      driverVersion: "1.2.3.4",
      list: ["mario", 42, null, true],
    });
    expect(out).toEqual({
      user: String.raw`[computer]\[user]`,
      ipv6: "[ip], ::1",
      gateway: "[ip]",
      macAddress: "[mac]",
      serialNumber: "[serial]",
      biosSerial: "Default string",
      driverVersion: "1.2.3.4",
      list: ["[user]", 42, null, true],
    });
  });

  it("reads this PC's names from the environment", () => {
    const pc = PersonalDataRedactor.forThisPc({
      USERNAME: "Lucia",
      USERPROFILE: String.raw`C:\Users\lucia.rossi`,
      COMPUTERNAME: "DESK-01",
      USERDOMAIN: "ACME",
    });
    expect(pc.redact("lucia.rossi Lucia DESK-01 ACME")).toBe(
      "[user] [user] [computer] [computer]",
    );
  });
});

describe("presentPayload", () => {
  const runtime = (redact: boolean) =>
    ({
      policy: { enabled: true, redact, path: "x" },
      redactor: new PersonalDataRedactor({ userNames: ["mario"] }),
    }) as unknown as ToolRuntime;

  it("masks tool output when redaction is on", () => {
    expect(presentPayload(runtime(true), { path: "mario" })).toEqual({
      path: "[user]",
    });
  });

  it("returns tool output unchanged when redaction is off", () => {
    const data = { path: "mario" };
    expect(presentPayload(runtime(false), data)).toBe(data);
  });
});
