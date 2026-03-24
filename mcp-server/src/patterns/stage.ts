import type { SymbolIndex, SymbolIndexCoverageIssue } from '../symbol-index/types.js';
import type { PatternIndex } from './types.js';
import { buildPatternIndexWithOptions } from './build-index.js';

export async function runPatternExtractionStage(
  reposRoot: string,
  index: SymbolIndex,
  options: {
    onIssue?: (issue: SymbolIndexCoverageIssue) => void;
  } = {},
): Promise<PatternIndex> {
  return buildPatternIndexWithOptions(reposRoot, index, options);
}
