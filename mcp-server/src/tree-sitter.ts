import path from 'node:path';

import Parser from 'tree-sitter';
import TypeScriptGrammar from 'tree-sitter-typescript';

const PARSERS = {
  '.ts': createParser(TypeScriptGrammar.typescript),
  '.tsx': createParser(TypeScriptGrammar.tsx),
} as const;

function createParser(language: unknown): Parser {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export function isSupportedSymbolFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.ts' || extension === '.tsx';
}

export function parseTypeScriptSource(filePath: string, source: string): Parser.Tree {
  const extension = path.extname(filePath).toLowerCase() as keyof typeof PARSERS;
  const parser = PARSERS[extension];

  if (!parser) {
    throw new Error(`Unsupported file type for symbol extraction: ${extension || '<none>'}`);
  }

  return parser.parse(source);
}
