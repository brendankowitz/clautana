import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  DEFAULT_PROFILE,
  parseAgentProfile,
  type AgentProfile,
} from "./AgentProfiles.js";

const CLAUTANA_DIR = ".clautana";
const SUBDIRS = ["memory", "agents", "messages", "context", "runs"] as const;

/**
 * Owns the on-disk `.clautana/` layout for one project. The layout is
 * byte-compatible with the VS Code extension's, so existing project folders
 * keep working after the pivot.
 */
export class ConfigManager {
  constructor(readonly projectRoot: string) {}

  get clautanaDir(): string {
    return join(this.projectRoot, CLAUTANA_DIR);
  }

  get runsDir(): string {
    return join(this.clautanaDir, "runs");
  }

  get agentsDir(): string {
    return join(this.clautanaDir, "agents");
  }

  async initialize(): Promise<void> {
    for (const sub of SUBDIRS) {
      await mkdir(join(this.clautanaDir, sub), { recursive: true });
    }
  }

  async loadProfiles(): Promise<Map<string, AgentProfile>> {
    const profiles = new Map<string, AgentProfile>();

    let entries: string[];
    try {
      entries = await readdir(this.agentsDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (extname(entry) !== ".json") {
        continue;
      }
      // A single malformed profile must not prevent the project opening.
      try {
        const raw = await readFile(join(this.agentsDir, entry), "utf8");
        const profile = parseAgentProfile(JSON.parse(raw));
        if (profile) {
          profiles.set(basename(entry, ".json"), profile);
        }
      } catch {
        continue;
      }
    }

    if (!profiles.has("default")) {
      profiles.set("default", DEFAULT_PROFILE);
    }
    return profiles;
  }
}
