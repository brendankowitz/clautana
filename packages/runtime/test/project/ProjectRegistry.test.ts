import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry } from "../../src/project/ProjectRegistry.js";

let root: string;
let registry: ProjectRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clautana-project-"));
  registry = new ProjectRegistry();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ProjectRegistry", () => {
  it("creates the .clautana layout on open", async () => {
    await registry.open(root);

    for (const sub of ["memory", "agents", "messages", "context", "runs"]) {
      const info = await stat(join(root, ".clautana", sub));
      expect(info.isDirectory()).toBe(true);
    }
  });

  it("returns a stable projectId for the same path", async () => {
    const first = await registry.open(root);
    const second = await registry.open(root);
    expect(second.projectId).toBe(first.projectId);
  });

  it("returns different ids for different paths", async () => {
    const other = await mkdtemp(join(tmpdir(), "clautana-project-b-"));
    const a = await registry.open(root);
    const b = await registry.open(other);
    expect(a.projectId).not.toBe(b.projectId);
    await rm(other, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== "win32")(
    "returns the same projectId for differently-cased paths on Windows",
    async () => {
      const upper = root.toUpperCase();
      const lower = root.toLowerCase();

      const a = await registry.open(upper);
      const b = await registry.open(lower);

      expect(b.projectId).toBe(a.projectId);
      expect(registry.get(b.projectId)).toBe(a.config);
    },
  );

  it("resolves an opened project by id", async () => {
    const { projectId } = await registry.open(root);
    expect(registry.get(projectId)).toBeDefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  it("rejects a path that is not a directory", async () => {
    const file = join(root, "a-file.txt");
    await writeFile(file, "x", "utf8");
    await expect(registry.open(file)).rejects.toThrow(/not a directory/i);
  });

  it("loads agent profiles from .clautana/agents", async () => {
    const agentsDir = join(root, ".clautana", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "coder.json"),
      JSON.stringify({ name: "Coder", role: "engineer", focus: "implementation" }),
      "utf8",
    );

    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();

    expect(profiles.get("coder")?.name).toBe("Coder");
  });

  it("returns a default profile set when the agents dir is empty", async () => {
    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();
    expect(profiles.has("default")).toBe(true);
  });

  it("ignores malformed profile files rather than failing the open", async () => {
    const agentsDir = join(root, ".clautana", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "broken.json"), "{ not json", "utf8");

    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();

    expect(profiles.has("broken")).toBe(false);
    expect(profiles.has("default")).toBe(true);
  });
});
