import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigManager } from "./ConfigManager.js";

export interface OpenedProject {
  projectId: string;
  config: ConfigManager;
}

/** Tracks the projects the runtime currently has open. */
export class ProjectRegistry {
  private readonly projects = new Map<string, ConfigManager>();

  async open(path: string): Promise<OpenedProject> {
    const root = resolve(path);

    const info = await stat(root).catch(() => undefined);
    if (!info) {
      throw new Error(`Project path does not exist: ${root}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Project path is not a directory: ${root}`);
    }

    // Path-derived so reopening the same folder yields the same id across restarts.
    // Windows paths are case-insensitive: C:\Work and c:\work are one directory and
    // must yield one projectId. POSIX paths are case-SENSITIVE, where /Foo and /foo
    // are genuinely different directories - lowercasing there would merge them.
    const idSource = process.platform === "win32" ? root.toLowerCase() : root;
    const projectId = createHash("sha256").update(idSource).digest("hex").slice(0, 16);

    const existing = this.projects.get(projectId);
    if (existing) {
      return { projectId, config: existing };
    }

    const config = new ConfigManager(root);
    await config.initialize();
    this.projects.set(projectId, config);
    return { projectId, config };
  }

  get(projectId: string): ConfigManager | undefined {
    return this.projects.get(projectId);
  }
}
