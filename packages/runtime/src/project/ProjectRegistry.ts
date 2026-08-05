import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigManager } from "./ConfigManager.js";

export interface OpenedProject {
  projectId: string;
  config: ConfigManager;
}

/**
 * Maps a failed `stat()` on a project path to the error `open()` should throw.
 * Only `ENOENT` means "does not exist" - permission failures (`EACCES`/`EPERM`,
 * e.g. another user's profile folder or a network share with dropped
 * credentials) and anything else must surface as themselves rather than being
 * flattened into a misleading "does not exist".
 */
export function describeStatError(error: unknown, path: string): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return new Error(`Project path does not exist: ${path}`);
  }
  if (code === "EACCES" || code === "EPERM") {
    return new Error(`Cannot access project path (permission denied): ${path}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Tracks the projects the runtime currently has open. */
export class ProjectRegistry {
  private readonly projects = new Map<string, ConfigManager>();

  async open(path: string): Promise<OpenedProject> {
    const root = resolve(path);

    let info: Stats;
    try {
      info = await stat(root);
    } catch (error) {
      throw describeStatError(error, root);
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
