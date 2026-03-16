import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { runPatternExtractionStage } from '../patterns/stage.js';
import { savePatternIndex } from '../patterns/store.js';
import { buildUiCompositionIndex } from '../ui-composition/build-index.js';
import { saveUiCompositionIndex } from '../ui-composition/store.js';
import { buildUiPropSurfaceIndex } from '../ui-props/build-index.js';
import { saveUiPropSurfaceIndex } from '../ui-props/store.js';
import { buildIndexedSymbols } from './build-index.js';
import { saveSymbolIndex } from './store.js';
import type { SymbolIndex } from './types.js';

export async function buildSymbolIndex(reposRoot: string): Promise<SymbolIndex> {
  const index = await buildIndexedSymbols(reposRoot);
  await saveSymbolIndex(index);
  return index;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const index = await buildSymbolIndex(config.reposRoot);
  const patternIndex = await runPatternExtractionStage(config.reposRoot, index);
  const uiCompositionIndex = await buildUiCompositionIndex(config.reposRoot, index);
  const uiPropSurfaceIndex = await buildUiPropSurfaceIndex(config.reposRoot, index);
  await savePatternIndex(patternIndex);
  await saveUiCompositionIndex(uiCompositionIndex);
  await saveUiPropSurfaceIndex(uiPropSurfaceIndex);
  console.log(`Indexed ${index.symbols.length} symbols.`);
  console.log(`Indexed ${patternIndex.patterns.length} pattern candidates.`);
  console.log(`Indexed ${uiCompositionIndex.edges.length} UI composition edges.`);
  console.log(`Indexed ${uiPropSurfaceIndex.propUsages.length} UI prop usages.`);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && process.argv[1] === currentFilePath) {
  main().catch((error: unknown) => {
    console.error('Failed to build symbol index.', error);
    process.exit(1);
  });
}
