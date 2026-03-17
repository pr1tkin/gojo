import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { refreshIndexes } from '../indexing/refresh.js';
import type { SymbolIndex } from './types.js';

export async function buildSymbolIndex(reposRoot: string): Promise<SymbolIndex> {
  const result = await refreshIndexes(reposRoot);
  return result.symbolIndex;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await refreshIndexes(config.reposRoot);
  console.log(`Indexed generation ${result.diagnostics.generationId}.`);
  console.log(`Indexed ${result.diagnostics.counts.symbols} symbols.`);
  console.log(`Indexed ${result.diagnostics.counts.patterns} pattern candidates.`);
  console.log(`Indexed ${result.diagnostics.counts.uiCompositionEdges} UI composition edges.`);
  console.log(`Indexed ${result.diagnostics.counts.uiPropUsages} UI prop usages.`);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && process.argv[1] === currentFilePath) {
  main().catch((error: unknown) => {
    console.error('Failed to build symbol index.', error);
    process.exit(1);
  });
}
