import { analyzeSymbolInputSchema } from '../schemas.js';
import { getAnalyzeSymbolContext } from '../orchestrator/index.js';
import type { AnalyzeSymbolInput } from '../types.js';

export const analyzeSymbolToolDefinition = {
  name: 'analyze_symbol',
  title: 'Analyze Symbol',
  description: 'Assemble structured symbol analysis using symbol, graph, and file-context signals.',
  inputSchema: analyzeSymbolInputSchema,
};

export async function runAnalyzeSymbolTool(
  input: AnalyzeSymbolInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await getAnalyzeSymbolContext(input);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
