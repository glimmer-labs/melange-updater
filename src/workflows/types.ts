import { Octokit } from '@octokit/rest';
import { Logger } from '../core/logger';
import { findMelangePackages } from '../integrations/melange';
import { UpdateMap } from '../types';

export interface WorkflowContext {
  absRepoPath: string;
  octo: Octokit;
  issueTracker: Set<string>;
  logger: Logger;
}

export type PackageMap = ReturnType<typeof findMelangePackages>;

export interface PackageError {
  name: string;
  phase: string;
  message: string;
}

export interface DiscoveryResult {
  packages: PackageMap;
  updates: UpdateMap;
  packageErrors: PackageError[];
}

export interface PrWorkflowResult {
  createdPRs: { name: string; url: string }[];
  failedPackages: string[];
  packageErrors: PackageError[];
}
