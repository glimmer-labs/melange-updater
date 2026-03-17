import { UpdateConfig } from './update';

export interface PipelineStep {
  uses?: string;
  with?: {
    repository?: string;
    branch?: string;
  };
}

export interface PackageDoc {
  package?: {
    name?: string;
    version?: string;
    epoch?: number;
  };
  Package?: {
    name?: string;
    version?: string;
    epoch?: number;
  };
  update?: UpdateConfig;
  pipeline?: PipelineStep[];
  [key: string]: unknown;
}

export interface PackageInfo {
  file: string;
  doc: PackageDoc;
}
