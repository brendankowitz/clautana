import { EventEmitter } from "events";
import { FileClaim } from "../coordinator/types";

/**
 * ClaimsTracker manages file ownership claims across all agents.
 *
 * Responsibilities:
 * - Tracks which agents have claimed which files/paths
 * - Supports exclusive and shared claims
 * - Handles claim expiration via TTL
 * - Validates new claims against existing ones
 *
 * Events emitted:
 * - claimsUpdated: When claims are added or released
 */
export class ClaimsTracker extends EventEmitter {
  private readonly claims = new Map<string, FileClaim>();

  /**
   * Add claims for an agent
   */
  addClaims(
    agentName: string,
    paths: string[],
    exclusive: boolean,
    reason?: string,
    ttlSeconds?: number
  ): void {
    const now = new Date();
    const expiresAt = ttlSeconds
      ? new Date(now.getTime() + ttlSeconds * 1000)
      : new Date(now.getTime() + 3600 * 1000); // Default 1 hour

    for (const pathPattern of paths) {
      const claimId = `${agentName}:${pathPattern}`;

      // Check for conflicts with exclusive claims
      if (exclusive) {
        const existingClaim = this.findConflictingClaim(pathPattern, agentName);
        if (existingClaim) {
          throw new Error(
            `Path "${pathPattern}" is already claimed by ${existingClaim.agentName}`
          );
        }
      }

      const claim: FileClaim = {
        id: claimId,
        agentName,
        pathPattern,
        exclusive,
        reason,
        createdAt: now,
        expiresAt,
      };

      this.claims.set(claimId, claim);
    }

    // Clean up expired claims
    this.cleanupExpiredClaims();

    // Emit event for UI updates
    this.emit("claimsUpdated", this.getAllClaims());
  }

  /**
   * Release all claims for an agent
   */
  releaseClaims(agentName: string): void {
    let released = false;
    for (const [id, claim] of this.claims) {
      if (claim.agentName === agentName) {
        this.claims.delete(id);
        released = true;
      }
    }
    if (released) {
      this.emit("claimsUpdated", this.getAllClaims());
    }
  }

  /**
   * Release a specific claim
   */
  releaseClaim(claimId: string): void {
    if (this.claims.has(claimId)) {
      this.claims.delete(claimId);
      this.emit("claimsUpdated", this.getAllClaims());
    }
  }

  /**
   * Get all current claims
   */
  getAllClaims(): FileClaim[] {
    this.cleanupExpiredClaims();
    return Array.from(this.claims.values());
  }

  /**
   * Get claims for a specific agent
   */
  getClaimsForAgent(agentName: string): FileClaim[] {
    return this.getAllClaims().filter((claim) => claim.agentName === agentName);
  }

  /**
   * Get all claims that match a specific path
   */
  getClaimsForPath(path: string): FileClaim[] {
    this.cleanupExpiredClaims();
    const matchingClaims: FileClaim[] = [];
    for (const claim of this.claims.values()) {
      if (this.pathMatchesPattern(path, claim.pathPattern)) {
        matchingClaims.push(claim);
      }
    }
    return matchingClaims;
  }

  /**
   * Check if a path is claimed by any agent
   */
  isPathClaimed(path: string): FileClaim | undefined {
    for (const claim of this.claims.values()) {
      if (this.pathMatchesPattern(path, claim.pathPattern)) {
        return claim;
      }
    }
    return undefined;
  }

  /**
   * Check if an agent can claim a path
   */
  canClaim(agentName: string, path: string, exclusive: boolean): boolean {
    const existingClaim = this.isPathClaimed(path);
    if (!existingClaim) {
      return true;
    }

    // Same agent can always update their claim
    if (existingClaim.agentName === agentName) {
      return true;
    }

    // If existing claim is exclusive, no one else can claim
    if (existingClaim.exclusive) {
      return false;
    }

    // If we want exclusive and there's any existing claim from another agent
    if (exclusive) {
      return false;
    }

    // Non-exclusive claims can coexist
    return true;
  }

  /**
   * Find a conflicting exclusive claim
   */
  private findConflictingClaim(pathPattern: string, excludeAgent: string): FileClaim | undefined {
    for (const claim of this.claims.values()) {
      if (claim.agentName === excludeAgent) {
        continue;
      }

      if (claim.exclusive && this.patternsOverlap(pathPattern, claim.pathPattern)) {
        return claim;
      }
    }
    return undefined;
  }

  /**
   * Check if a path matches a pattern (supports glob-like patterns)
   */
  private pathMatchesPattern(path: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = path.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Simple glob matching
    if (normalizedPattern.includes("**")) {
      const parts = normalizedPattern.split("**");
      const prefix = parts[0];
      const suffix = parts[1] ?? "";

      return (
        normalizedPath.startsWith(prefix) &&
        (suffix === "" || normalizedPath.endsWith(suffix.replace(/^\//, "")))
      );
    }

    if (normalizedPattern.includes("*")) {
      const regex = new RegExp(
        "^" + normalizedPattern.replace(/\*/g, "[^/]*").replace(/\//g, "\\/") + "$"
      );
      return regex.test(normalizedPath);
    }

    // Exact match or directory prefix
    return (
      normalizedPath === normalizedPattern ||
      normalizedPath.startsWith(normalizedPattern + "/")
    );
  }

  /**
   * Check if two patterns potentially overlap
   */
  private patternsOverlap(pattern1: string, pattern2: string): boolean {
    const normalized1 = pattern1.replace(/\\/g, "/");
    const normalized2 = pattern2.replace(/\\/g, "/");

    // If either contains **, they might overlap
    if (normalized1.includes("**") || normalized2.includes("**")) {
      const base1 = normalized1.split("**")[0];
      const base2 = normalized2.split("**")[0];
      return base1.startsWith(base2) || base2.startsWith(base1);
    }

    // Check if one is a prefix of the other
    return (
      normalized1.startsWith(normalized2) ||
      normalized2.startsWith(normalized1) ||
      normalized1 === normalized2
    );
  }

  /**
   * Remove expired claims
   */
  private cleanupExpiredClaims(): void {
    const now = new Date();
    for (const [id, claim] of this.claims) {
      if (claim.expiresAt < now) {
        this.claims.delete(id);
      }
    }
  }
}
