// SessionStart hook: reports Claude Code tooling status for the current project phase.
// Read-only and non-blocking; any failure prints a short note and exits 0.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const home = homedir();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listDirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function mcpServerNames() {
  const names = new Set();
  const projectMcp = readJson(join(projectDir, ".mcp.json"));
  for (const n of Object.keys(projectMcp?.mcpServers ?? {})) names.add(n);
  const userConfig = readJson(join(home, ".claude.json"));
  for (const n of Object.keys(userConfig?.mcpServers ?? {})) names.add(n);
  const projects = userConfig?.projects ?? {};
  for (const [path, cfg] of Object.entries(projects)) {
    if (path.replace(/\\/g, "/").toLowerCase() === projectDir.replace(/\\/g, "/").toLowerCase()) {
      for (const n of Object.keys(cfg?.mcpServers ?? {})) names.add(n);
    }
  }
  return names;
}

function enabledPluginNames() {
  const names = new Set();
  for (const file of [
    join(home, ".claude", "settings.json"),
    join(projectDir, ".claude", "settings.json"),
    join(projectDir, ".claude", "settings.local.json"),
  ]) {
    const enabled = readJson(file)?.enabledPlugins ?? {};
    for (const [key, on] of Object.entries(enabled)) {
      if (on) names.add(key.split("@")[0].toLowerCase());
    }
  }
  return names;
}

function skillDirNames() {
  return [
    join(projectDir, ".claude", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
  ].flatMap(listDirs);
}

function main() {
  const tooling = readJson(join(projectDir, ".claude", "tooling.json"));
  if (!tooling) {
    console.log("[tooling-check] .claude/tooling.json not found or invalid; skipping.");
    return;
  }

  const phase = Number(tooling.currentPhase ?? 0);
  const mcp = mcpServerNames();
  const plugins = enabledPluginNames();
  const skills = skillDirNames();

  const status = (tool) => {
    if (tool.type === "mcp") return mcp.has(tool.name) ? "ok" : "missing";
    if (tool.type === "skills") {
      const re = new RegExp(tool.detect ?? tool.name, "i");
      return skills.some((s) => re.test(s)) ? "ok" : "missing";
    }
    // Account-level plugins are not visible on disk; Claude confirms them via the plugin listing.
    return plugins.has(tool.name.toLowerCase()) ? "ok" : "unverified";
  };

  const due = tooling.tools.filter((t) => t.phase <= phase);
  const next = tooling.tools.filter((t) => t.phase === phase + 1);

  const missing = due.filter((t) => status(t) === "missing");
  const unverified = due.filter((t) => status(t) === "unverified");
  const ok = due.filter((t) => status(t) === "ok");

  const line = (t) =>
    `  - ${t.name} (${t.type}): ${t.install}${t.signIn ? ` — needs: ${t.signIn}` : ""}`;

  const out = [`[tooling-check] Shakti Prime — current phase: ${phase}`];
  if (ok.length) out.push(`Installed: ${ok.map((t) => t.name).join(", ")}`);
  if (missing.length) out.push("MISSING (needed now):", ...missing.map(line));
  if (unverified.length)
    out.push("Plugins to confirm via plugin listing (not visible on disk):", ...unverified.map(line));
  if (next.length) out.push(`Coming in phase ${phase + 1}:`, ...next.map(line));
  if (!missing.length && !unverified.length) out.push("All tools for this phase are in place.");
  console.log(out.join("\n"));
}

try {
  main();
} catch (err) {
  console.log(`[tooling-check] skipped: ${err?.message ?? err}`);
}
