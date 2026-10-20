/**
 * Config snippets that register Pulse Bridge in AI apps.
 *
 * The bridge prints them instead of editing the apps' files: those files
 * belong to the user (Pulse 1.3 removed PulseMCP partly because writing
 * third-party configs caused support issues).
 */

export const CLIENT_CONFIG_TARGETS = [
  "opencode",
  "claude-desktop",
  "claude-code",
  "cursor",
  "vscode",
] as const;

export type ClientConfigTarget = (typeof CLIENT_CONFIG_TARGETS)[number];

/** Key used in the apps' server maps. Not "pulse", which old Pulse builds cleaned up. */
export const SERVER_KEY = "pulse-bridge";

export function clientConfig(
  target: ClientConfigTarget,
  entry: string,
  node = process.execPath,
): { where: string; text: string } {
  switch (target) {
    case "opencode":
      return {
        where:
          "opencode.json in your project, or ~/.config/opencode/opencode.json for every project",
        text: json({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            [SERVER_KEY]: { type: "local", command: [node, entry], enabled: true },
          },
        }),
      };
    case "claude-desktop":
      return {
        where:
          "%APPDATA%\\Claude\\claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config)",
        text: json({ mcpServers: { [SERVER_KEY]: { command: node, args: [entry] } } }),
      };
    case "claude-code":
      return {
        where: "run this once in a terminal",
        text: `claude mcp add --scope user ${SERVER_KEY} -- ${quote(node)} ${quote(entry)}\n`,
      };
    case "cursor":
      return {
        where: "%USERPROFILE%\\.cursor\\mcp.json",
        text: json({ mcpServers: { [SERVER_KEY]: { command: node, args: [entry] } } }),
      };
    case "vscode":
      return {
        where: ".vscode/mcp.json in your workspace",
        text: json({
          servers: { [SERVER_KEY]: { type: "stdio", command: node, args: [entry] } },
        }),
      };
  }
}

/** Prints the snippet for [target]; returns the process exit code. */
export function printClientConfig(target: string | undefined, entry: string): number {
  if (!target || !(CLIENT_CONFIG_TARGETS as readonly string[]).includes(target)) {
    process.stderr.write(
      `Choose an app: ${CLIENT_CONFIG_TARGETS.join(", ")}\n` +
        "Example: pulse-bridge --print-config opencode\n",
    );
    return 2;
  }
  const { where, text } = clientConfig(target as ClientConfigTarget, entry);
  process.stderr.write(`Add this to ${where}:\n\n`);
  process.stdout.write(text);
  return 0;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
