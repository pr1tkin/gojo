import { describe, expect, it } from 'vitest';

import { isSupportedSymbolFile, parseTypeScriptSource } from '../../src/tree-sitter.js';

describe('tree-sitter parser setup', () => {
  it('reports .ts and .tsx files as supported', () => {
    expect(isSupportedSymbolFile('src/hello.ts')).toBe(true);
    expect(isSupportedSymbolFile('src/component.tsx')).toBe(true);
    expect(isSupportedSymbolFile('README.md')).toBe(false);
  });

  it('parses TypeScript source without failing', () => {
    const tree = parseTypeScriptSource(
      'src/hello.ts',
      'export function greet() { return "hello"; }',
    );

    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('parses TSX source without failing', () => {
    const tree = parseTypeScriptSource(
      'src/component.tsx',
      'export const Button = () => <button>ok</button>;',
    );

    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('rejects unsupported file types clearly', () => {
    expect(() => parseTypeScriptSource('README.md', '# heading')).toThrow(
      /unsupported file type/i,
    );
  });
});
