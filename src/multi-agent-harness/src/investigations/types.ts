/**
 * Types for Investigation and Spec Browser
 */

export type WorkflowMode = 'adr' | 'spec-kit' | 'hybrid' | 'auto';

/**
 * Investigation (ADR workflow)
 */
export interface Investigation {
  id: string;
  featureName: string;
  topic: string;
  title: string;
  status: 'exploring' | 'viable' | 'accepted' | 'rejected';
  filePath: string;
  created: Date;
  updated: Date;
  summary?: string;
}

/**
 * Spec (Spec-Kit workflow)
 */
export interface Spec {
  id: string;
  featureName: string;
  title: string;
  status: 'draft' | 'review' | 'approved' | 'implemented';
  filePath: string;
  created: Date;
  updated: Date;
  summary?: string;
}

/**
 * ADR (Architecture Decision Record)
 */
export interface ADR {
  id: string;
  featureName: string;
  title: string;
  status: 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'deprecated';
  filePath: string;
  created: Date;
  updated: Date;
  decision?: string;
}

/**
 * Feature folder
 */
export interface Feature {
  name: string;
  path: string;
  investigations: Investigation[];
  specs: Spec[];
  adrs: ADR[];
  created: Date;
  updated: Date;
}

/**
 * Browser item - union type for display
 */
export type BrowserItem = Investigation | Spec | ADR;

/**
 * Browser view mode
 */
export type BrowserViewMode = 'features' | 'investigations' | 'specs' | 'adrs';
