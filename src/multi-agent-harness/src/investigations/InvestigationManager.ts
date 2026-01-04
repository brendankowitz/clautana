import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Investigation, Spec, ADR, Feature, BrowserViewMode } from './types';

/**
 * Manages investigations, specs, and ADRs in the .clautana folder
 */
export class InvestigationManager extends EventEmitter {
  private clautanaDir: string | null = null;
  private initialized = false;

  async initialize(workspaceRoot: string): Promise<void> {
    if (!workspaceRoot) {
      throw new Error('InvestigationManager.initialize() requires a valid workspaceRoot path');
    }
    this.clautanaDir = path.join(workspaceRoot, '.clautana');
    await fs.mkdir(this.clautanaDir, { recursive: true });
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.clautanaDir) {
      return;
    }

    // Try to auto-initialize with workspace folder
    try {
      const vscode = await import('vscode');
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceFolder = workspaceFolders[0];
        const fsPath = workspaceFolder?.uri?.fsPath;
        if (fsPath && typeof fsPath === 'string' && fsPath.length > 0) {
          await this.initialize(fsPath);
          return;
        }
      }
    } catch (error) {
      console.error('[InvestigationManager] Auto-initialize failed:', error);
    }

    throw new Error('InvestigationManager not initialized. Call initialize() with workspace path first.');
  }

  /**
   * Get all features
   */
  async getFeatures(): Promise<Feature[]> {
    await this.ensureInitialized();

    const featuresDir = path.join(this.clautanaDir!, 'features');

    try {
      await fs.access(featuresDir);
    } catch {
      // Features directory doesn't exist yet
      return [];
    }

    const featureDirs = await fs.readdir(featuresDir);
    const features: Feature[] = [];

    for (const featureName of featureDirs) {
      const featurePath = path.join(featuresDir, featureName);
      const stats = await fs.stat(featurePath);

      if (stats.isDirectory()) {
        const feature = await this.parseFeature(featureName, featurePath);
        features.push(feature);
      }
    }

    // Sort by updated date (newest first)
    features.sort((a, b) => b.updated.getTime() - a.updated.getTime());

    return features;
  }

  /**
   * Parse a feature folder
   */
  private async parseFeature(featureName: string, featurePath: string): Promise<Feature> {
    const investigations = await this.getInvestigationsForFeature(featurePath);
    const specs = await this.getSpecsForFeature(featurePath);
    const adrs = await this.getADRsForFeature(featurePath);

    // Get latest update time
    const allDates = [
      ...investigations.map(i => i.updated),
      ...specs.map(s => s.updated),
      ...adrs.map(a => a.updated),
    ];
    const updated = allDates.length > 0
      ? new Date(Math.max(...allDates.map(d => d.getTime())))
      : new Date();

    // Get earliest creation time
    const creationDates = [
      ...investigations.map(i => i.created),
      ...specs.map(s => s.created),
      ...adrs.map(a => a.created),
    ];
    const created = creationDates.length > 0
      ? new Date(Math.min(...creationDates.map(d => d.getTime())))
      : new Date();

    return {
      name: featureName,
      path: path.join(featurePath, 'README.md'), // Point to README.md instead of directory
      investigations,
      specs,
      adrs,
      created,
      updated,
    };
  }

  /**
   * Get investigations for a feature
   */
  private async getInvestigationsForFeature(featurePath: string): Promise<Investigation[]> {
    const investigationsDir = path.join(featurePath, 'investigations');

    try {
      await fs.access(investigationsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(investigationsDir);
    const investigations: Investigation[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(investigationsDir, file);
        const investigation = await this.parseInvestigation(filePath);
        investigations.push(investigation);
      }
    }

    return investigations;
  }

  /**
   * Get specs for a feature
   */
  private async getSpecsForFeature(featurePath: string): Promise<Spec[]> {
    const specsDir = path.join(featurePath, 'specs');

    try {
      await fs.access(specsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(specsDir);
    const specs: Spec[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(specsDir, file);
        const spec = await this.parseSpec(filePath);
        specs.push(spec);
      }
    }

    return specs;
  }

  /**
   * Get ADRs for a feature
   */
  private async getADRsForFeature(featurePath: string): Promise<ADR[]> {
    const adrDir = path.join(featurePath, 'adr');

    try {
      await fs.access(adrDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(adrDir);
    const adrs: ADR[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(adrDir, file);
        const adr = await this.parseADR(filePath);
        adrs.push(adr);
      }
    }

    return adrs;
  }

  /**
   * Parse an investigation markdown file
   */
  private async parseInvestigation(filePath: string): Promise<Investigation> {
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);

    // Extract feature name from path
    const pathParts = filePath.split(path.sep);
    const featuresIndex = pathParts.indexOf('features');
    const featureName = featuresIndex >= 0 ? pathParts[featuresIndex + 1] : 'unknown';

    // Extract topic from filename (e.g., "redis-approach.md" -> "redis-approach")
    const fileName = path.basename(filePath, '.md');
    const topic = fileName;

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : topic;

    // Determine status from content
    let status: Investigation['status'] = 'exploring';
    if (content.includes('## Status: Viable') || content.includes('Status: ✅ Viable') || content.includes('**Status:** Viable')) {
      status = 'viable';
    } else if (content.includes('## Status: Planned') || content.includes('Status: 📋 Planned') || content.includes('**Status:** Planned')) {
      status = 'planned';
    } else if (content.includes('## Status: Rejected') || content.includes('Status: ❌ Rejected') || content.includes('**Status:** Rejected')) {
      status = 'rejected';
    }

    // Extract summary from first paragraph or description section
    const summaryMatch = content.match(/(?:## Summary|## Description)\s*\n\n([^\n]+)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

    // Generate ID from feature and topic
    const id = `${featureName}/${topic}`;

    return {
      id,
      featureName,
      topic,
      title,
      status,
      filePath,
      created: stats.birthtime,
      updated: stats.mtime,
      summary,
    };
  }

  /**
   * Parse a spec markdown file
   */
  private async parseSpec(filePath: string): Promise<Spec> {
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);

    // Extract feature name from path
    const pathParts = filePath.split(path.sep);
    const featuresIndex = pathParts.indexOf('features');
    const featureName = featuresIndex >= 0 ? pathParts[featuresIndex + 1] : 'unknown';

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.md');

    // Determine status from content
    let status: Spec['status'] = 'draft';
    if (content.includes('Status: Approved') || content.includes('## Status: Approved')) {
      status = 'approved';
    } else if (content.includes('Status: Review') || content.includes('## Status: Review')) {
      status = 'review';
    } else if (content.includes('Status: Implemented') || content.includes('## Status: Implemented')) {
      status = 'implemented';
    }

    // Extract summary
    const summaryMatch = content.match(/(?:## Summary|## Overview)\s*\n\n([^\n]+)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

    // Generate ID
    const id = `${featureName}/${path.basename(filePath, '.md')}`;

    return {
      id,
      featureName,
      title,
      status,
      filePath,
      created: stats.birthtime,
      updated: stats.mtime,
      summary,
    };
  }

  /**
   * Parse an ADR markdown file
   */
  private async parseADR(filePath: string): Promise<ADR> {
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);

    // Extract feature name from path
    const pathParts = filePath.split(path.sep);
    const featuresIndex = pathParts.indexOf('features');
    const featureName = featuresIndex >= 0 ? pathParts[featuresIndex + 1] : 'unknown';

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.md');

    // Determine status
    let status: ADR['status'] = 'proposed';
    if (content.includes('Status: Accepted') || content.includes('## Status: Accepted')) {
      status = 'accepted';
    } else if (content.includes('Status: Rejected') || content.includes('## Status: Rejected')) {
      status = 'rejected';
    } else if (content.includes('Status: Superseded') || content.includes('## Status: Superseded')) {
      status = 'superseded';
    }

    // Extract decision
    const decisionMatch = content.match(/## Decision\s*\n\n([^\n]+)/);
    const decision = decisionMatch ? decisionMatch[1].trim() : undefined;

    // Generate ID
    const id = `${featureName}/${path.basename(filePath, '.md')}`;

    return {
      id,
      featureName,
      title,
      status,
      filePath,
      created: stats.birthtime,
      updated: stats.mtime,
      decision,
    };
  }

  /**
   * Get all items for a specific view mode
   */
  async getItemsForView(viewMode: BrowserViewMode): Promise<(Investigation | Spec | ADR)[]> {
    const features = await this.getFeatures();
    const items: (Investigation | Spec | ADR)[] = [];

    for (const feature of features) {
      switch (viewMode) {
        case 'investigations':
          items.push(...feature.investigations);
          break;
        case 'specs':
          items.push(...feature.specs);
          break;
        case 'adrs':
          items.push(...feature.adrs);
          break;
      }
    }

    return items;
  }
}

// Singleton instance
let instance: InvestigationManager | null = null;

export function getInvestigationManager(): InvestigationManager {
  if (!instance) {
    instance = new InvestigationManager();
  }
  return instance;
}
