import type { SymbolIndex } from '../symbol-index/types.js';
import type { PatternIndex } from './types.js';
import { buildPatternIndex } from './build-index.js';

export async function runPatternExtractionStage(reposRoot: string, index: SymbolIndex): Promise<PatternIndex> {
  return buildPatternIndex(reposRoot, index);
}
