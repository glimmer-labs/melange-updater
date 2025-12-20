export interface GitConfig {
  repository?: string;
  branch?: string;
  tag_filter_prefix?: string;
  tag_filter_contains?: string;
  tag_filter?: string;
  strip_prefix?: string;
  strip_suffix?: string;
}

export interface GithubConfig {
  identifier?: string;
  use_tag?: boolean;
  tag_filter_prefix?: string;
  tag_filter_contains?: string;
  tag_filter?: string;
  strip_prefix?: string;
  strip_suffix?: string;
}

export interface ReleaseMonitorConfig {
  identifier?: string;
  version_filter_prefix?: string;
  version_filter_contains?: string;
  strip_prefix?: string;
  strip_suffix?: string;
}

export interface VersionTransformRule {
  match: string;
  replace: string;
}

export interface UpdateConfig {
  enabled?: boolean;
  manual?: boolean;
  version_separator?: string;
  ignore_regex_patterns?: string[];
  version_transform?: VersionTransformRule[];
  release_monitor?: ReleaseMonitorConfig;
  github?: GithubConfig;
  git?: GitConfig;
}

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

export interface UpdateEntry {
  from: string;
  to: string;
  file: string;
  manual: boolean;
  commit: string;
}

export type UpdateMap = Record<string, UpdateEntry>;
