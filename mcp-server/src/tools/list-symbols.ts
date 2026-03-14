import { listSymbolsInputSchema } from '../schemas.js';
import { listSymbolsForFile } from '../symbols.js';
import type { ListSymbolsInput } from '../types.js';

export const listSymbolsToolDefinition = {
  name: 'list_symbols',
  title: 'List Symbols',
  description: 'Parses a TypeScript or TSX file and returns detected symbols.',
  inputSchema: listSymbolsInputSchema,
};

export async function runListSymbolsTool(
  reposRoot: string,
  input: ListSymbolsInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await listSymbolsForFile(reposRoot, input.filePath);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
