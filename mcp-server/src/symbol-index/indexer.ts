import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
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
  console.log(`Indexed ${index.symbols.length} symbols.`);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && process.argv[1] === currentFilePath) {
  main().catch((error: unknown) => {
    console.error('Failed to build symbol index.', error);
    process.exit(1);
  });
}
