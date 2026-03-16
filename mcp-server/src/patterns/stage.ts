import type { SymbolIndex } from '../symbol-index/types.js';
import { PATTERN_INDEX_SCHEMA_VERSION, type PatternIndex } from './types.js';

export async function runPatternExtractionStage(_reposRoot: string, index: SymbolIndex): Promise<PatternIndex> {
  return {
    schemaVersion: PATTERN_INDEX_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: index.schemaVersion,
    generatedAt: new Date().toISOString(),
    patterns: [],
  };
}
