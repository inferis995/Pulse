/**
 * Masks details that identify a person or a machine before tool output
 * leaves the bridge (usually for a cloud model).
 *
 * Port of Pulse's PersonalDataRedactor
 * (apps/pulse_app/lib/features/privacy/personal_data_redactor.dart), so the
 * bridge masks the same things Pulse masks in shared reports:
 * - user names and the user part of `C:\Users\<name>\` paths → `[user]`
 * - computer and domain names → `[computer]`
 * - account SIDs (`S-1-5-21-…`) → `S-1-5-21-[sid]`
 * - e-mail addresses → `[email]`
 * - IPv4 and MAC addresses → `[ip]` / `[mac]`
 * - values of serial-number fields and given secrets → `[serial]`
 *
 * In addition to Pulse's text rules, JSON values under address keys
 * (`ipv6`, `gateway`, …) are masked whole, because IPv6 addresses have
 * too many spellings to find reliably in free text.
 *
 * Kept: Event IDs, providers, timestamps, versions, hardware models — what
 * is needed to understand a problem. Well-known SIDs (S-1-5-18 SYSTEM, …)
 * and loopback / unspecified IPs are not personal and stay.
 */
export class PersonalDataRedactor {
  static readonly userToken = "[user]";
  static readonly computerToken = "[computer]";
  static readonly serialToken = "[serial]";

  /** Shared profile folders that do not identify anyone. */
  private static readonly sharedProfiles = new Set([
    "public",
    "default",
    "default user",
    "all users",
  ]);

  private static readonly profilePath =
    /([A-Za-z]:\\+Users\\+)([^\\/:*?"<>|\r\n]+)/gi;
  private static readonly accountSid = /S-1-5-21(?:-\d+){3,4}/g;
  private static readonly email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  private static readonly mac = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
  private static readonly ipv4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

  /** JSON keys whose string value is a serial number or hardware id. */
  private static readonly serialKey = /serial|assettag|uuid|hardwareid/i;

  /** JSON keys whose string value is a network address. */
  private static readonly addressKey =
    /^(ipv4|ipv6|ip|ipaddress|gateway|dns|macaddress|mac)$/i;

  private readonly userNames: string[];
  private readonly computerNames: string[];
  private readonly secrets: string[];

  constructor(opts: {
    userNames?: Iterable<string>;
    computerNames?: Iterable<string>;
    secrets?: Iterable<string>;
  } = {}) {
    this.userNames = usable(opts.userNames ?? []);
    this.computerNames = usable(opts.computerNames ?? []);
    this.secrets = usable(
      [...(opts.secrets ?? [])].filter((s) => !isPlaceholder(s)),
    );
  }

  /** Uses this PC's user, profile folder, computer and domain name. */
  static forThisPc(env: NodeJS.ProcessEnv = process.env): PersonalDataRedactor {
    const profile = env.USERPROFILE ?? "";
    const profileName =
      profile.split(/[\\/]/).filter((p) => p.length > 0).pop() ?? "";
    const computer = env.COMPUTERNAME ?? "";
    const domain = env.USERDOMAIN ?? "";
    return new PersonalDataRedactor({
      userNames: [env.USERNAME ?? "", profileName],
      computerNames: [
        computer,
        ...(domain.toUpperCase() !== computer.toUpperCase() ? [domain] : []),
      ],
    });
  }

  /** Masks [text]; returns it unchanged when nothing matches. */
  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const secret of this.secrets) {
      out = out.replace(
        new RegExp(escapeRegExp(secret), "gi"),
        PersonalDataRedactor.serialToken,
      );
    }
    out = out.replace(PersonalDataRedactor.profilePath, (all, prefix, name) =>
      PersonalDataRedactor.sharedProfiles.has(String(name).toLowerCase())
        ? all
        : `${prefix}${PersonalDataRedactor.userToken}`,
    );
    for (const name of this.userNames) {
      out = replaceWord(out, name, PersonalDataRedactor.userToken);
    }
    for (const name of this.computerNames) {
      out = replaceWord(out, name, PersonalDataRedactor.computerToken);
    }
    out = out.replace(PersonalDataRedactor.accountSid, "S-1-5-21-[sid]");
    out = out.replace(PersonalDataRedactor.email, "[email]");
    out = out.replace(PersonalDataRedactor.mac, "[mac]");
    out = out.replace(PersonalDataRedactor.ipv4, (all, a, b, c, d) => {
      const octets = [a, b, c, d].map((o) => Number(o));
      if (octets.some((o) => o > 255)) return all; // a version number
      if (octets[0] === 127 || octets.every((o) => o === 0)) return all;
      return "[ip]";
    });
    return out;
  }

  /** Masks every string inside a JSON-like value (objects, arrays, strings). */
  redactJson(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
      // Versions such as "1.2.0.4" look like IPv4 addresses and are not personal.
      if (key && /version/i.test(key)) return value;
      if (key && value.trim().length > 0) {
        if (PersonalDataRedactor.serialKey.test(key) && !isPlaceholder(value)) {
          return PersonalDataRedactor.serialToken;
        }
        if (PersonalDataRedactor.addressKey.test(key)) {
          return maskAddressList(value, /mac/i.test(key) ? "[mac]" : "[ip]");
        }
      }
      return this.redact(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redactJson(v, key));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.redactJson(v, k);
      }
      return out;
    }
    return value;
  }
}

/** Masks each entry of a comma / space separated list, keeping loopback. */
function maskAddressList(value: string, token: string): string {
  return value
    .split(/([,;\s]+)/)
    .map((part) => {
      if (/^[,;\s]*$/.test(part)) return part;
      const p = part.toLowerCase();
      const loopback =
        p === "::1" || p === "::" || p === "0.0.0.0" || p.startsWith("127.");
      return loopback ? part : token;
    })
    .join("");
}

/** Values firmware ships when nobody set a real serial number. */
const PLACEHOLDERS = new Set([
  "to be filled by o.e.m.",
  "default string",
  "not specified",
  "not applicable",
  "none",
  "n/a",
  "unknown",
  "system serial number",
  "chassis serial number",
  "base board serial number",
  "0123456789",
]);

function usable(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    // Shorter names would match inside ordinary words.
    if (v.length < 2) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  // Longest first, so "SHOP-PC-2" is masked before "SHOP-PC".
  return out.sort((a, b) => b.length - a.length);
}

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  // Shorter hardware identifiers are not identifying (and are often "0").
  return v.length < 4 || PLACEHOLDERS.has(v.toLowerCase()) || /^[0\s.-]+$/.test(v);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive: "Sinan" masks "sinan\" but not "Sinanoglu". */
function replaceWord(text: string, value: string, token: string): string {
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, "gi"),
    token,
  );
}
