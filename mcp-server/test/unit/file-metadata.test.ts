import { describe, expect, it } from 'vitest';

import { extractFileMetadata } from '../../src/symbol-index/file-metadata.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import type { IndexedSymbol } from '../../src/symbol-index/types.js';

function createSymbol(
  fileId: string,
  name: string,
  kind: IndexedSymbol['kind'],
  ordinal: number,
): IndexedSymbol {
  return {
    symbolId: createSymbolId(fileId, kind, name, ordinal),
    fileId,
    name,
    kind,
    repo: 'meta-repo',
    filePath: 'src/metadata.ts',
    startLine: ordinal,
    endLine: ordinal,
    exported: false,
    declarationFingerprint: `${kind}:${name}:${ordinal}`,
  };
}

describe('extractFileMetadata', () => {
  it('extracts structured imports and exports from common TypeScript forms', () => {
    const fileId = createFileId('meta-repo', 'src/metadata.ts');
    const symbols: IndexedSymbol[] = [
      createSymbol(fileId, 'exportedConst', 'variable', 1),
      createSymbol(fileId, 'exportedFn', 'function', 1),
      createSymbol(fileId, 'ExportedClass', 'class', 1),
      createSymbol(fileId, 'defaultValue', 'variable', 1),
      createSymbol(fileId, 'localAlias', 'variable', 1),
    ];
    const source = [
      "import DefaultThing from './default';",
      "import { Foo, Bar as Baz, type TypedThing } from './named';",
      "import * as Utils from './utils';",
      "import type { TypeOnlyValue } from './types';",
      'export const exportedConst = 1;',
      'export function exportedFn(): void {}',
      'export class ExportedClass {}',
      'const defaultValue = exportedConst;',
      'const localAlias = exportedConst;',
      'export default defaultValue;',
      'export { localAlias as renamedValue, type TypeOnlyValue };',
      "export { Foo as ReExportedFoo } from './named';",
      "export * from './everything';",
    ].join('\n');

    const relation = extractFileMetadata(
      fileId,
      'meta-repo',
      'src/metadata.ts',
      'source',
      source,
      symbols,
    );

    expect(relation).toEqual(
      expect.objectContaining({
        fileId,
        repo: 'meta-repo',
        filePath: 'src/metadata.ts',
        classification: 'source',
        symbolIds: symbols.map((symbol) => symbol.symbolId),
        symbolNames: ['defaultValue', 'ExportedClass', 'exportedConst', 'exportedFn', 'localAlias'],
        importTokens: [
          './default',
          './named',
          './types',
          './utils',
          'Bar',
          'Baz',
          'default',
          'DefaultThing',
          'Foo',
          'TypedThing',
          'TypeOnlyValue',
          'Utils',
        ],
      }),
    );
    expect(relation.imports).toEqual([
      {
        fileId,
        source: './default',
        bindings: [
          {
            importedName: 'default',
            localName: 'DefaultThing',
            kind: 'default',
            isTypeOnly: false,
          },
        ],
        resolvedKind: 'local-file',
      },
      {
        fileId,
        source: './named',
        bindings: [
          {
            importedName: 'Foo',
            localName: 'Foo',
            kind: 'named',
            isTypeOnly: false,
          },
          {
            importedName: 'Bar',
            localName: 'Baz',
            kind: 'named',
            isTypeOnly: false,
          },
          {
            importedName: 'TypedThing',
            localName: 'TypedThing',
            kind: 'named',
            isTypeOnly: true,
          },
        ],
        resolvedKind: 'local-file',
      },
      {
        fileId,
        source: './utils',
        bindings: [
          {
            importedName: null,
            localName: 'Utils',
            kind: 'namespace',
            isTypeOnly: false,
          },
        ],
        resolvedKind: 'local-file',
      },
      {
        fileId,
        source: './types',
        bindings: [
          {
            importedName: 'TypeOnlyValue',
            localName: 'TypeOnlyValue',
            kind: 'named',
            isTypeOnly: true,
          },
        ],
        resolvedKind: 'local-file',
      },
    ]);
    expect(relation.exports).toEqual([
      {
        fileId,
        kind: 'named',
        exportedName: 'exportedConst',
        localName: 'exportedConst',
        isTypeOnly: false,
        symbolId: createSymbolId(fileId, 'variable', 'exportedConst', 1),
      },
      {
        fileId,
        kind: 'named',
        exportedName: 'exportedFn',
        localName: 'exportedFn',
        isTypeOnly: false,
        symbolId: createSymbolId(fileId, 'function', 'exportedFn', 1),
      },
      {
        fileId,
        kind: 'named',
        exportedName: 'ExportedClass',
        localName: 'ExportedClass',
        isTypeOnly: false,
        symbolId: createSymbolId(fileId, 'class', 'ExportedClass', 1),
      },
      {
        fileId,
        kind: 'default',
        exportedName: 'default',
        localName: 'defaultValue',
        symbolId: createSymbolId(fileId, 'variable', 'defaultValue', 1),
      },
      {
        fileId,
        kind: 'named',
        exportedName: 'renamedValue',
        localName: 'localAlias',
        isTypeOnly: false,
        symbolId: createSymbolId(fileId, 'variable', 'localAlias', 1),
      },
      {
        fileId,
        kind: 'named',
        exportedName: 'TypeOnlyValue',
        localName: 'TypeOnlyValue',
        isTypeOnly: true,
        symbolId: undefined,
      },
      {
        fileId,
        kind: 'reexport-named',
        exportedName: 'ReExportedFoo',
        localName: 'Foo',
        source: './named',
        isTypeOnly: false,
        symbolId: undefined,
      },
      {
        fileId,
        kind: 'reexport-all',
        source: './everything',
      },
    ]);
  });

  it('extracts export default function metadata', () => {
    const fileId = createFileId('meta-repo', 'src/default-export.ts');
    const symbols: IndexedSymbol[] = [
      {
        symbolId: createSymbolId(fileId, 'function', 'DefaultComponent', 1),
        fileId,
        name: 'DefaultComponent',
        kind: 'function',
        repo: 'meta-repo',
        filePath: 'src/default-export.ts',
        startLine: 1,
        endLine: 3,
        exported: true,
        declarationFingerprint: 'function:DefaultComponent:1',
      },
    ];
    const relation = extractFileMetadata(
      fileId,
      'meta-repo',
      'src/default-export.ts',
      'source',
      'export default function DefaultComponent(): null { return null; }',
      symbols,
    );

    expect(relation.exports).toEqual([
      {
        fileId,
        kind: 'default',
        exportedName: 'default',
        localName: 'DefaultComponent',
        symbolId: createSymbolId(fileId, 'function', 'DefaultComponent', 1),
      },
    ]);
  });
});
