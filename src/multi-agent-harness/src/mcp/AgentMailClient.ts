/**
 * Agent Mail MCP Client
 *
 * This client connects to the MCP Agent Mail server for cross-agent messaging.
 * It provides methods to send messages, retrieve inboxes, and manage message state.
 *
 * Based on the multi-agent-vscode-extension-spec.md specification.
 */

import * as vscode from "vscode";
import { AgentMessage, McpServerConfig } from "../types";
import { spawn, ChildProcess } from "child_process";

/**
 * Response from Agent Mail server health check
 */
interface HealthCheckResponse {
  readonly status: string;
  readonly version?: string;
  readonly uptime?: number;
}

/**
 * Response from Agent Mail server API calls
 */
interface ApiResponse<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

/**
 * Agent Mail message format from server
 */
interface AgentMailMessage {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body?: string;
  readonly timestamp: string;
  readonly read: boolean;
}

/**
 * Client for connecting to the Agent Mail MCP server
 *
 * Handles HTTP communication with the Agent Mail server for cross-agent messaging.
 */
export class AgentMailClient {
  private baseUrl: string;
  private serverProcess?: ChildProcess;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Agent Mail Client");
    this.baseUrl = this.getConfiguredUrl();
  }

  /**
   * Get the configured Agent Mail server URL from VS Code settings
   */
  private getConfiguredUrl(): string {
    const config = vscode.workspace.getConfiguration("multiAgent");
    const mcpServers = config.get<Record<string, McpServerConfig>>("mcpServers");

    if (mcpServers?.["agent-mail"]?.transport === "http") {
      return mcpServers["agent-mail"].url || "http://localhost:8765";
    }

    return "http://localhost:8765";
  }

  /**
   * Check if the Agent Mail server is running and accessible
   *
   * @returns True if server is healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as HealthCheckResponse;
      return data.status === "ok" || data.status === "healthy";
    } catch (error) {
      // Connection refused, timeout, or other network error
      this.outputChannel.appendLine(`Health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Start the Agent Mail server if not already running
   *
   * Spawns the server as a child process and waits for it to become ready.
   * For HTTP transport, this just checks if the server is accessible.
   */
  async start(): Promise<void> {
    // Check if already running
    const isRunning = await this.healthCheck();
    if (isRunning) {
      this.outputChannel.appendLine("Agent Mail server is already running");
      return;
    }

    // Get server configuration
    const config = vscode.workspace.getConfiguration("multiAgent");
    const mcpServers = config.get<Record<string, McpServerConfig>>("mcpServers");
    const agentMailConfig = mcpServers?.["agent-mail"];

    if (!agentMailConfig) {
      this.outputChannel.appendLine("Agent Mail server not configured - skipping");
      return;
    }

    // Only stdio transport can be started by us
    // For HTTP transport, the server must be started externally
    if (agentMailConfig.transport !== "stdio") {
      this.outputChannel.appendLine(
        "Agent Mail server configured with HTTP transport - assuming external server. " +
        "Start the server manually if needed."
      );
      return;
    }

    const command = agentMailConfig.command;
    const args = agentMailConfig.args || [];
    const env = { ...process.env, ...(agentMailConfig.env || {}) };

    if (!command) {
      throw new Error("Agent Mail server command not configured");
    }

    this.outputChannel.appendLine(`Starting Agent Mail server: ${command} ${args.join(" ")}`);

    // Spawn the server process
    this.serverProcess = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    // Handle server output
    this.serverProcess.stdout?.on("data", (data) => {
      this.outputChannel.appendLine(`[Agent Mail] ${data.toString()}`);
    });

    this.serverProcess.stderr?.on("data", (data) => {
      this.outputChannel.appendLine(`[Agent Mail Error] ${data.toString()}`);
    });

    this.serverProcess.on("error", (error) => {
      this.outputChannel.appendLine(`Agent Mail server error: ${error.message}`);
    });

    this.serverProcess.on("exit", (code, signal) => {
      this.outputChannel.appendLine(
        `Agent Mail server exited with code ${code}, signal ${signal}`
      );
      this.serverProcess = undefined;
    });

    // Wait for server to become ready (poll health endpoint)
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const isReady = await this.healthCheck();
      if (isReady) {
        this.outputChannel.appendLine("Agent Mail server started successfully");
        return;
      }

      this.outputChannel.appendLine(`Waiting for server to start (attempt ${attempt + 1}/${maxAttempts})...`);
    }

    // Timeout
    this.stop();
    throw new Error("Agent Mail server failed to start within timeout period");
  }

  /**
   * Stop the Agent Mail server if it was started by this client
   */
  stop(): void {
    if (this.serverProcess) {
      this.outputChannel.appendLine("Stopping Agent Mail server...");
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }

  /**
   * Send a message from one agent to another
   *
   * @param from Sender agent name
   * @param to Recipient agent name
   * @param subject Message subject
   * @param body Optional message body
   */
  async sendMessage(
    from: string,
    to: string,
    subject: string,
    body?: string
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject,
          body: body || "",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ApiResponse;
      if (!result.success) {
        throw new Error(result.error || "Failed to send message");
      }

      this.outputChannel.appendLine(`Message sent: ${from} → ${to}: "${subject}"`);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to send message: ${error}`);
      throw new Error(`Failed to send message to Agent Mail server: ${error}`);
    }
  }

  /**
   * Get all messages in an agent's inbox
   *
   * @param agentName Name of the agent whose inbox to retrieve
   * @returns Array of messages for the agent
   */
  async getInbox(agentName: string): Promise<AgentMessage[]> {
    try {
      const response = await fetch(`${this.baseUrl}/inbox/${encodeURIComponent(agentName)}`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ApiResponse<AgentMailMessage[]>;
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to retrieve inbox");
      }

      // Convert server format to our AgentMessage format
      return result.data.map((msg) => this.convertToAgentMessage(msg));
    } catch (error) {
      this.outputChannel.appendLine(`Failed to get inbox for ${agentName}: ${error}`);
      throw new Error(`Failed to retrieve inbox from Agent Mail server: ${error}`);
    }
  }

  /**
   * Mark a message as read
   *
   * @param messageId ID of the message to mark as read
   */
  async markRead(messageId: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/messages/${encodeURIComponent(messageId)}/read`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ read: true }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ApiResponse;
      if (!result.success) {
        throw new Error(result.error || "Failed to mark message as read");
      }

      this.outputChannel.appendLine(`Marked message ${messageId} as read`);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to mark message as read: ${error}`);
      throw new Error(`Failed to mark message as read: ${error}`);
    }
  }

  /**
   * Get all unread messages for an agent
   *
   * @param agentName Name of the agent
   * @returns Array of unread messages
   */
  async getUnreadMessages(agentName: string): Promise<AgentMessage[]> {
    const inbox = await this.getInbox(agentName);
    return inbox.filter((msg) => !msg.read);
  }

  /**
   * Delete a message
   *
   * @param messageId ID of the message to delete
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ApiResponse;
      if (!result.success) {
        throw new Error(result.error || "Failed to delete message");
      }

      this.outputChannel.appendLine(`Deleted message ${messageId}`);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to delete message: ${error}`);
      throw new Error(`Failed to delete message: ${error}`);
    }
  }

  /**
   * Clear all messages for an agent
   *
   * @param agentName Name of the agent whose inbox to clear
   */
  async clearInbox(agentName: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/inbox/${encodeURIComponent(agentName)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ApiResponse;
      if (!result.success) {
        throw new Error(result.error || "Failed to clear inbox");
      }

      this.outputChannel.appendLine(`Cleared inbox for ${agentName}`);
    } catch (error) {
      this.outputChannel.appendLine(`Failed to clear inbox: ${error}`);
      throw new Error(`Failed to clear inbox: ${error}`);
    }
  }

  /**
   * Convert server message format to AgentMessage format
   */
  private convertToAgentMessage(msg: AgentMailMessage): AgentMessage {
    return {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      body: msg.body,
      timestamp: new Date(msg.timestamp),
      read: msg.read,
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
  }
}
