/**
 * MCP (Model Context Protocol) Services
 *
 * This module provides MCP-related functionality for the multi-agent harness:
 * - AgentMailClient: Client for cross-agent messaging via Agent Mail server
 * - McpManager: Lifecycle management for MCP servers
 * - ClaimsTracker: Track file reservations across agents
 */

export { AgentMailClient } from "./AgentMailClient";
export { McpManager, McpServerStatus } from "./McpManager";
export { ClaimsTracker } from "./ClaimsTracker";
