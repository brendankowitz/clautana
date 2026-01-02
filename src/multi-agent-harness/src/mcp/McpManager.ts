/**
 * MCP Server Manager
 *
 * Manages the lifecycle of MCP (Model Context Protocol) servers used by agents.
 * Tracks running servers, starts/stops them, and monitors their health status.
 *
 * Based on the multi-agent-vscode-extension-spec.md specification.
 */

import * as vscode from "vscode";
import { McpServerConfig } from "../types";
import { spawn, ChildProcess } from "child_process";

/**
 * Status of an MCP server
 */
export type McpServerStatus = "running" | "stopped" | "error" | "starting";

/**
 * Runtime state of an MCP server instance
 */
interface McpServerInstance {
  /** Server name/identifier */
  readonly name: string;

  /** Server configuration */
  readonly config: McpServerConfig;

  /** Current status */
  status: McpServerStatus;

  /** Child process (for stdio transport) */
  process?: ChildProcess;

  /** Error message if status is 'error' */
  error?: string;

  /** When the server was started */
  startedAt?: Date;

  /** Number of restart attempts */
  restartAttempts: number;
}

/**
 * Options for starting an MCP server
 */
interface StartServerOptions {
  /** Auto-restart on failure */
  autoRestart?: boolean;

  /** Maximum restart attempts */
  maxRestartAttempts?: number;

  /** Health check interval in milliseconds */
  healthCheckInterval?: number;
}

/**
 * Manages MCP server instances
 *
 * Provides centralized management of MCP servers including:
 * - Starting/stopping servers
 * - Health monitoring
 * - Auto-restart on failure
 * - Status tracking
 */
export class McpManager {
  private servers: Map<string, McpServerInstance>;
  private outputChannel: vscode.OutputChannel;
  private healthCheckTimers: Map<string, NodeJS.Timeout>;
  private readonly defaultOptions: Required<StartServerOptions> = {
    autoRestart: true,
    maxRestartAttempts: 3,
    healthCheckInterval: 30000, // 30 seconds
  };

  constructor() {
    this.servers = new Map();
    this.healthCheckTimers = new Map();
    this.outputChannel = vscode.window.createOutputChannel("MCP Manager");
  }

  /**
   * Start an MCP server
   *
   * @param name Unique identifier for this server
   * @param config Server configuration
   * @param options Optional startup options
   */
  async startServer(
    name: string,
    config: McpServerConfig,
    options?: StartServerOptions
  ): Promise<void> {
    const opts = { ...this.defaultOptions, ...options };

    // Check if server is already running
    const existing = this.servers.get(name);
    if (existing && existing.status === "running") {
      this.outputChannel.appendLine(`Server '${name}' is already running`);
      return;
    }

    this.outputChannel.appendLine(`Starting MCP server '${name}' (${config.transport})...`);

    const instance: McpServerInstance = {
      name,
      config,
      status: "starting",
      restartAttempts: 0,
    };

    this.servers.set(name, instance);

    try {
      if (config.transport === "stdio") {
        await this.startStdioServer(instance, opts);
      } else if (config.transport === "http") {
        await this.startHttpServer(instance, opts);
      } else {
        throw new Error(`Unsupported transport type: ${config.transport}`);
      }

      instance.status = "running";
      instance.startedAt = new Date();
      instance.restartAttempts = 0;

      this.outputChannel.appendLine(`Server '${name}' started successfully`);

      // Start health monitoring if configured
      if (opts.healthCheckInterval > 0) {
        this.startHealthMonitoring(name, opts);
      }
    } catch (error) {
      instance.status = "error";
      instance.error = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Failed to start server '${name}': ${instance.error}`);
      throw error;
    }
  }

  /**
   * Start a server using stdio transport
   */
  private async startStdioServer(
    instance: McpServerInstance,
    options: Required<StartServerOptions>
  ): Promise<void> {
    const { config, name } = instance;

    if (!config.command) {
      throw new Error(`No command specified for stdio server '${name}'`);
    }

    const args = config.args || [];
    const processEnv = { ...process.env, ...(config.env || {}) };

    this.outputChannel.appendLine(`Spawning: ${config.command} ${args.join(" ")}`);

    const childProcess = spawn(config.command, args, {
      env: processEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    instance.process = childProcess;

    // Handle process output
    childProcess.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(`[${name} stdout] ${data.toString()}`);
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(`[${name} stderr] ${data.toString()}`);
    });

    childProcess.on("error", (error: Error) => {
      this.outputChannel.appendLine(`[${name}] Process error: ${error.message}`);
      instance.status = "error";
      instance.error = error.message;

      if (options.autoRestart) {
        this.attemptRestart(name, options);
      }
    });

    childProcess.on("exit", (code: number | null, signal: string | null) => {
      this.outputChannel.appendLine(
        `[${name}] Process exited with code ${code}, signal ${signal}`
      );
      instance.status = "stopped";
      instance.process = undefined;

      if (options.autoRestart && instance.restartAttempts < options.maxRestartAttempts) {
        this.attemptRestart(name, options);
      }
    });

    // Give the process a moment to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if process is still running
    if (childProcess.exitCode !== null || childProcess.killed) {
      throw new Error("Process exited immediately after starting");
    }
  }

  /**
   * Start a server using HTTP transport
   */
  private async startHttpServer(
    instance: McpServerInstance,
    _options: Required<StartServerOptions>
  ): Promise<void> {
    const { config, name } = instance;

    if (!config.url) {
      throw new Error(`No URL specified for HTTP server '${name}'`);
    }

    // For HTTP servers, we assume they're already running externally
    // We just verify connectivity
    const isAccessible = await this.checkHttpHealth(config.url);

    if (!isAccessible) {
      throw new Error(
        `HTTP server at ${config.url} is not accessible. Please start it manually.`
      );
    }
  }

  /**
   * Stop an MCP server
   *
   * @param name Name of the server to stop
   */
  async stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) {
      this.outputChannel.appendLine(`Server '${name}' not found`);
      return;
    }

    this.outputChannel.appendLine(`Stopping server '${name}'...`);

    // Stop health monitoring
    this.stopHealthMonitoring(name);

    // Kill the process if it's running
    if (instance.process) {
      instance.process.kill("SIGTERM");

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (instance.process && !instance.process.killed) {
        instance.process.kill("SIGKILL");
      }

      instance.process = undefined;
    }

    instance.status = "stopped";
    this.outputChannel.appendLine(`Server '${name}' stopped`);
  }

  /**
   * Get the status of a server
   *
   * @param name Name of the server
   * @returns Server status
   */
  getServerStatus(name: string): McpServerStatus {
    const instance = this.servers.get(name);
    return instance?.status || "stopped";
  }

  /**
   * Get detailed information about a server
   *
   * @param name Name of the server
   * @returns Server instance or undefined if not found
   */
  getServerInfo(name: string): Readonly<McpServerInstance> | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all running servers
   *
   * @returns Array of server names that are currently running
   */
  getRunningServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, instance]) => instance.status === "running")
      .map(([name, _]) => name);
  }

  /**
   * Get all registered servers
   *
   * @returns Map of all servers
   */
  getAllServers(): ReadonlyMap<string, Readonly<McpServerInstance>> {
    return this.servers;
  }

  /**
   * Check if a server is running
   *
   * @param name Name of the server
   * @returns True if server is running
   */
  isServerRunning(name: string): boolean {
    return this.getServerStatus(name) === "running";
  }

  /**
   * Restart a server
   *
   * @param name Name of the server to restart
   */
  async restartServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) {
      throw new Error(`Server '${name}' not found`);
    }

    this.outputChannel.appendLine(`Restarting server '${name}'...`);

    await this.stopServer(name);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startServer(name, instance.config);
  }

  /**
   * Attempt to restart a failed server
   */
  private async attemptRestart(
    name: string,
    options: Required<StartServerOptions>
  ): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) {
      return;
    }

    instance.restartAttempts++;

    if (instance.restartAttempts >= options.maxRestartAttempts) {
      this.outputChannel.appendLine(
        `Server '${name}' exceeded max restart attempts (${options.maxRestartAttempts})`
      );
      return;
    }

    this.outputChannel.appendLine(
      `Attempting to restart server '${name}' (attempt ${instance.restartAttempts}/${options.maxRestartAttempts})...`
    );

    // Exponential backoff
    const delayMs = Math.min(1000 * Math.pow(2, instance.restartAttempts - 1), 30000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      if (instance.config.transport === "stdio") {
        await this.startStdioServer(instance, options);
        instance.status = "running";
        instance.startedAt = new Date();
        this.outputChannel.appendLine(`Server '${name}' restarted successfully`);
      }
    } catch (error) {
      this.outputChannel.appendLine(
        `Failed to restart server '${name}': ${error}`
      );
    }
  }

  /**
   * Start health monitoring for a server
   */
  private startHealthMonitoring(
    name: string,
    options: Required<StartServerOptions>
  ): void {
    // Clear existing timer if any
    this.stopHealthMonitoring(name);

    const timer = setInterval(async () => {
      const instance = this.servers.get(name);
      if (!instance || instance.status !== "running") {
        this.stopHealthMonitoring(name);
        return;
      }

      const isHealthy = await this.performHealthCheck(instance);
      if (!isHealthy) {
        this.outputChannel.appendLine(`Health check failed for server '${name}'`);
        instance.status = "error";
        instance.error = "Health check failed";

        if (options.autoRestart) {
          this.attemptRestart(name, options);
        }
      }
    }, options.healthCheckInterval);

    this.healthCheckTimers.set(name, timer);
  }

  /**
   * Stop health monitoring for a server
   */
  private stopHealthMonitoring(name: string): void {
    const timer = this.healthCheckTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(name);
    }
  }

  /**
   * Perform health check on a server
   */
  private async performHealthCheck(instance: McpServerInstance): Promise<boolean> {
    if (instance.config.transport === "stdio") {
      // For stdio, check if process is still running
      return instance.process !== undefined && !instance.process.killed;
    } else if (instance.config.transport === "http" && instance.config.url) {
      // For HTTP, ping the health endpoint
      return await this.checkHttpHealth(instance.config.url);
    }

    return false;
  }

  /**
   * Check HTTP server health
   */
  private async checkHttpHealth(url: string): Promise<boolean> {
    try {
      const healthUrl = url.endsWith("/") ? `${url}health` : `${url}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Stop all servers and clean up resources
   */
  async dispose(): Promise<void> {
    this.outputChannel.appendLine("Stopping all MCP servers...");

    // Stop all health monitoring
    const timerNames = Array.from(this.healthCheckTimers.keys());
    for (const name of timerNames) {
      this.stopHealthMonitoring(name);
    }

    // Stop all servers
    const stopPromises = Array.from(this.servers.keys()).map((name) =>
      this.stopServer(name)
    );

    await Promise.all(stopPromises);

    this.servers.clear();
    this.outputChannel.dispose();
  }
}
