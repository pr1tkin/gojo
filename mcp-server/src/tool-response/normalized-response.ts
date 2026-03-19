import { buildNormalizedDiagnostics, type BuildNormalizedDiagnosticsInput } from './diagnostics-builder.js';
import { buildNormalizedExpansions } from './expansion-builder.js';
import { buildNormalizedSummary } from './summary-builder.js';
import type {
  NormalizedExpansion,
  NormalizedEvidenceItem,
  NormalizedMode,
  NormalizedNextAction,
  NormalizedQuery,
  NormalizedResultBase,
  NormalizedSummary,
  NormalizedToolResponse,
} from './normalized-types.js';

export const NORMALIZED_TOOL_RESPONSE_VERSION = '1';

export interface CreateNormalizedResponseInput<T extends NormalizedResultBase> {
  tool: string;
  mode: NormalizedMode;
  query: NormalizedQuery;
  results?: {
    primary: T[];
    secondary?: T[];
  };
  summary?: NormalizedSummary;
  evidence?: NormalizedEvidenceItem[];
  nextActions?: NormalizedNextAction[];
  diagnostics?: BuildNormalizedDiagnosticsInput;
  expansions?: NormalizedExpansion[];
  version?: string;
}

/**
 * Canonical envelope for future public-response normalization.
 *
 * Raw tool and service outputs remain tool-specific. Later adapter modules will
 * map raw results into this envelope without rewriting the underlying engines.
 */
export function createNormalizedResponse<T extends NormalizedResultBase>(
  input: CreateNormalizedResponseInput<T>,
): NormalizedToolResponse<T> {
  const results = input.results ?? { primary: [] };

  return {
    tool: input.tool,
    version: input.version ?? NORMALIZED_TOOL_RESPONSE_VERSION,
    mode: input.mode,
    query: input.query,
    summary: input.summary ?? buildNormalizedSummary({ results }),
    results,
    evidence: input.evidence ?? [],
    nextActions: input.nextActions ?? [],
    diagnostics: buildNormalizedDiagnostics(input.diagnostics),
    expansions: buildNormalizedExpansions(input.expansions),
  };
}
