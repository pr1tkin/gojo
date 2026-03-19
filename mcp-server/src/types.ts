export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  reposRoot: string;
  zoektBaseUrl: string;
}

export interface RepositoryInfo {
  id: string;
  name: string;
  rootPath: string;
  isGitRepository: boolean;
}

export interface FileSliceOptions {
  startLine?: number;
  endLine?: number;
}

export interface OpenFileInput extends FileSliceOptions {
  filePath: string;
}

export interface FileReadResult {
  repositoryId: string;
  filePath: string;
  absolutePath: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

export interface SearchCodeInput {
  query: string;
  repoName?: string;
  pathPrefix?: string;
  limit?: number;
}

export interface ZoektSearchRequest {
  query: string;
  repoName?: string;
  pathPrefix?: string;
  limit: number;
}

export interface ZoektSearchResponse {
  result?: {
    FileMatches?: ZoektFileMatch[];
  };
}

export interface ZoektFileMatch {
  FileName?: string;
  Repo?: string;
  Matches?: ZoektLineMatch[];
}

export interface ZoektLineMatch {
  LineNum?: number;
  Fragments?: ZoektMatchFragment[];
}

export interface ZoektMatchFragment {
  Pre?: string;
  Match?: string;
  Post?: string;
}

export interface SearchMatch {
  repository: string;
  filePath: string;
  lineNumber: number;
  snippet: string;
}

export interface SearchCodeResult {
  query: string;
  appliedQuery: string;
  matchCount: number;
  truncated: boolean;
  matches: SearchMatch[];
  searchFreshness?: {
    status: 'pending' | 'ready' | 'stale' | 'failed' | 'unknown';
    requestedAt?: string;
    refreshedAt?: string;
    details?: string;
    error?: string;
  };
  warnings?: string[];
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'typeAlias'
  | 'variable'
  | 'method'
  | 'default_export';

export interface ListSymbolsInput {
  filePath: string;
}

export interface FileSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  identityDiscriminator?: 'default';
}

export interface ListSymbolsResult {
  filePath: string;
  symbolCount: number;
  symbols: FileSymbol[];
}

export interface FindSymbolInput {
  name: string;
  kind?: SymbolKind;
  repo?: string;
}

export interface FindReferencesInput {
  symbol: string;
  repo?: string;
  limit?: number;
}

export interface FindReferenceMatch {
  symbol: string;
  repo: string;
  filePath: string;
  line: number;
  snippet: string;
}

export interface FindRelatedFilesInput {
  filePath: string;
  repo?: string;
  limit?: number;
}

export interface ExploreComponentInput {
  name: string;
  repo?: string;
  limit?: number;
  relatedLimit?: number;
  detail?: 'agent' | 'debug';
  expandClusters?: boolean;
  expandDebug?: boolean;
  expandRelated?: boolean;
}

export type SearchPatternsMode = 'component' | 'symbol' | 'file';

export interface SearchPatternsInput {
  name: string;
  repo?: string;
  limit?: number;
  mode?: SearchPatternsMode;
  detail?: 'agent' | 'debug';
  expandClusters?: boolean;
  expandDebug?: boolean;
  expandRelated?: boolean;
}

export interface FindPrecedentsToolInput {
  name: string;
  repo?: string;
  limit?: number;
  mode?: SearchPatternsMode;
  detail?: 'agent' | 'debug';
  includeFamilyContext?: boolean;
  expandClusters?: boolean;
  expandDebug?: boolean;
  expandRelated?: boolean;
}

export type RefactorContextMode = 'file' | 'symbol' | 'component';

export interface CollectRefactorContextInput {
  name: string;
  repo?: string;
  mode?: RefactorContextMode;
  limit?: number;
  detail?: 'agent' | 'debug';
  expandClusters?: boolean;
  expandDebug?: boolean;
  expandRelated?: boolean;
}

export interface AnalyzeSymbolInput {
  name: string;
  repo?: string;
  file?: string;
  limit?: number;
}

export type PlanChangeMode = 'safe' | 'exploratory';

export interface PlanChangeInput {
  symbol: string;
  filePath?: string;
  repo?: string;
  mode?: PlanChangeMode;
}
