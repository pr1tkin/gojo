import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCodeGraph } from '../../src/graph/store.js';
import { getGenerationArtifactFilePath, loadCurrentGenerationState } from '../../src/indexing/generation-store.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { loadPatternIndex } from '../../src/patterns/store.js';
import { loadSymbolIndex } from '../../src/symbol-index/store.js';
import { loadUiCompositionIndex } from '../../src/ui-composition/store.js';
import { loadUiPropSurfaceIndex } from '../../src/ui-props/store.js';

interface PersistedChangeSummary {
  files: Array<{
    key: string;
    changeKind: string;
    signals: string[];
    impactHints: string[];
    confidence: string;
  }>;
  overview: {
    filesChanged: number;
    highRiskFiles: number;
  };
}

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-index-refresh-test-'));
}

async function writeRepositoryFile(
  reposRoot: string,
  repositoryId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(reposRoot, repositoryId, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

async function ensureRepository(reposRoot: string, repositoryId: string): Promise<void> {
  await fs.mkdir(path.join(reposRoot, repositoryId, '.git'), { recursive: true });
}

async function loadPersistedChangeSummary(): Promise<PersistedChangeSummary> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('expected a published generation state');
  }

  const content = await fs.readFile(getGenerationArtifactFilePath(state.generationId, 'change-summary.json'), 'utf8');
  return JSON.parse(content) as PersistedChangeSummary;
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential('refreshIndexes', () => {
  it('takes the no-op path when the repository manifest is unchanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    const second = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(first.diagnostics.status).toBe('committed');
    expect(second.diagnostics.status).toBe('no-op');
    expect(second.diagnostics.generationId).toBe(first.diagnostics.generationId);
    expect(second.diagnostics.delta).toEqual({
      added: [],
      modified: [],
      deleted: [],
    });
  });

  it('detects added files and indexes them into the published generation', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "a"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/b.ts',
      'export function beta(): string { return "b"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const state = await loadCurrentGenerationState();
    const changeSummary = await loadPersistedChangeSummary();

    expect(result.diagnostics.delta.added).toEqual(['app-repo/src/b.ts']);
    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/b.ts',
        changeKind: 'added',
        signals: expect.arrayContaining(['contentChanged', 'likelyApiBoundaryChanged', 'symbolSurfaceChanged']),
        impactHints: expect.arrayContaining([
          'mayAffectDependents',
          'mayAffectSearchFreshness',
          'requiresGraphRebuild',
          'requiresPatternRefresh',
          'requiresSymbolReindex',
        ]),
      }),
    ]);
    expect(changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/b.ts',
        changeKind: 'added',
      }),
    ]);
    expect(symbolIndex.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/b.ts',
          name: 'beta',
        }),
      ]),
    );
    expect(state?.manifest.map((entry) => entry.key)).toEqual([
      'app-repo/src/a.ts',
      'app-repo/src/b.ts',
    ]);
  });

  it('replaces stale derived data when a file is modified', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function oldName(): string { return "old"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function newName(): string { return "new"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const patternIndex = await loadPatternIndex();

    expect(result.diagnostics.delta.modified).toEqual(['app-repo/src/util.ts']);
    expect(result.diagnostics.changeSummary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'app-repo/src/util.ts',
          changeKind: 'modified',
          signals: expect.arrayContaining([
            'contentChanged',
            'exportsChanged',
            'graphRelevantChanged',
            'likelyApiBoundaryChanged',
            'symbolSurfaceChanged',
          ]),
          impactHints: expect.arrayContaining([
            'mayAffectDependents',
            'mayAffectSearchFreshness',
            'requiresGraphRebuild',
            'requiresSymbolReindex',
          ]),
        }),
      ]),
    );
    expect(symbolIndex.symbols.find((symbol) => symbol.name === 'oldName')).toBeUndefined();
    expect(symbolIndex.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/util.ts',
          name: 'newName',
        }),
      ]),
    );
    expect(patternIndex.patterns.find((pattern) => pattern.name === 'oldName')).toBeUndefined();
  });

  it('removes deleted files from symbols, graph edges, UI structure, and pattern artifacts', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Child.tsx',
      'export function Child() { return <span>child</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <Child />;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await fs.rm(path.join(reposRoot, 'app-repo', 'src', 'Child.tsx'));

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const graph = await loadCodeGraph();
    const uiComposition = await loadUiCompositionIndex();
    const patternIndex = await loadPatternIndex();

    expect(result.diagnostics.delta.deleted).toEqual(['app-repo/src/Child.tsx']);
    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Child.tsx',
        changeKind: 'deleted',
        signals: expect.arrayContaining([
          'exportsChanged',
          'likelyApiBoundaryChanged',
          'patternRelevantChanged',
          'symbolSurfaceChanged',
          'uiStructureChanged',
        ]),
        impactHints: expect.arrayContaining([
          'mayAffectDependents',
          'mayAffectSearchFreshness',
          'requiresGraphRebuild',
          'requiresPatternRefresh',
          'requiresSymbolReindex',
          'requiresUiRefresh',
        ]),
      }),
    ]);
    expect(symbolIndex.symbols.some((symbol) => symbol.filePath === 'src/Child.tsx')).toBe(false);
    expect(Object.values(symbolIndex.byFile).some((relation) => relation.filePath === 'src/Child.tsx')).toBe(false);
    expect(Object.values(graph.nodes.files).some((node) => node.filePath === 'src/Child.tsx')).toBe(false);
    expect(graph.edges.some((edge) => edge.fromId.includes('Child.tsx') || edge.toId.includes('Child.tsx'))).toBe(false);
    expect(
      uiComposition.edges.some(
        (edge) => edge.parentFilePath === 'src/Child.tsx' || edge.childFilePath === 'src/Child.tsx',
      ),
    ).toBe(false);
    expect(patternIndex.patterns.some((pattern) => pattern.fileId.includes('Child.tsx'))).toBe(false);
  });

  it('detects import and export changes as graph-relevant', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/b.ts', 'export const b = 2;');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/api.ts',
      ["import { a } from './a';", 'export { a };'].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/api.ts',
      ["import { b } from './b';", 'export default b;'].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/api.ts',
        signals: expect.arrayContaining([
          'contentChanged',
          'exportsChanged',
          'graphRelevantChanged',
          'importsChanged',
          'likelyApiBoundaryChanged',
        ]),
        impactHints: expect.arrayContaining([
          'mayAffectDependents',
          'requiresGraphRebuild',
          'requiresSymbolReindex',
        ]),
      }),
    ]);
  });

  it('detects UI structure and prop-surface changes in TSX files', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Child.tsx',
      'export function Child(props: { label?: string; tone?: string }) { return <span>{props.label}</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Other.tsx',
      'export function Other() { return <strong>other</strong>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        "import { Other } from './Other';",
        '',
        'export function Parent() {',
        '  return <Child label=\"before\" />;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        "import { Other } from './Other';",
        '',
        'export function Parent() {',
        '  return <Other><Child tone=\"primary\" /></Other>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const uiProps = await loadUiPropSurfaceIndex();

    expect(result.diagnostics.changeSummary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'app-repo/src/Parent.tsx',
          signals: expect.arrayContaining(['contentChanged', 'uiPropsChanged', 'uiStructureChanged']),
          impactHints: expect.arrayContaining(['requiresUiRefresh']),
        }),
      ]),
    );
    expect(
      uiProps.propUsages.some(
        (usage) =>
          usage.parentFilePath === 'src/Parent.tsx' &&
          usage.childComponentName === 'Child' &&
          usage.propName === 'tone',
      ),
    ).toBe(true);
  });

  it('detects prop changes on non-self-closing JSX component usages', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Badge.tsx',
      'export function Badge(props: { label?: string; tone?: string; title?: string }) { return <span>{props.label}</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        "import { Badge } from './Badge';",
        '',
        'export function Panel() {',
        '  return <Badge tone="subtle">hello</Badge>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        "import { Badge } from './Badge';",
        '',
        'export function Panel() {',
        '  return <Badge tone="subtle" title="greeting">hello</Badge>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Panel.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiPropsChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('classifies wrapper and layout changes as uiStructureChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Child.tsx',
      'export function Child() { return <span>child</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <section><Child /></section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <main><Child /></main>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Parent.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiStructureChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('classifies repeated child component additions as uiStructureChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Badge.tsx',
      'export function Badge() { return <span>badge</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        "import { Badge } from './Badge';",
        '',
        'export function Panel() {',
        '  return <section><Badge /></section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        "import { Badge } from './Badge';",
        '',
        'export function Panel() {',
        '  return <section><Badge /><Badge /></section>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Panel.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiStructureChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('classifies conditional rendering changes as uiRenderingChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        'export function Panel(props: { ready: boolean }) {',
        '  return <section>ready</section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        'export function Panel(props: { ready: boolean }) {',
        '  return <section>{props.ready ? <strong>ready</strong> : null}</section>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Panel.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiRenderingChanged', 'patternRelevantChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh', 'requiresPatternRefresh']),
      }),
    ]);
  });

  it('classifies JSX conditional form changes as uiRenderingChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        'export function Panel(props: { ready: boolean }) {',
        '  return <section>{props.ready && <strong>ready</strong>}</section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Panel.tsx',
      [
        'export function Panel(props: { ready: boolean }) {',
        '  return <section>{props.ready ? <strong>ready</strong> : <span>waiting</span>}</section>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Panel.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiRenderingChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('classifies simple JSX styling changes as uiStylingChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Card.tsx',
      [
        'export function Card() {',
        '  return <section className="before">card</section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Card.tsx',
      [
        'export function Card() {',
        '  return <section style={{ color: "red" }}>card</section>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Card.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiStylingChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('classifies className token changes as uiStylingChanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Card.tsx',
      [
        'export function Card() {',
        '  return <section className="mb-8 flex gap-2">card</section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Card.tsx',
      [
        'export function Card() {',
        '  return <section className="mb-8 bg-gray-50 flex gap-2">card</section>;',
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/Card.tsx',
        signals: expect.arrayContaining(['contentChanged', 'uiStylingChanged']),
        impactHints: expect.arrayContaining(['requiresUiRefresh']),
      }),
    ]);
  });

  it('detects pattern-relevant structural changes for derived pattern candidates', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/utils/api.ts',
      'export function slugify(value: string): string { return value.toLowerCase(); }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/utils/api.ts',
      [
        'export async function fetchUser(): Promise<Response> {',
        "  return fetch('/api/user');",
        '}',
      ].join('\n'),
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/utils/api.ts',
        signals: expect.arrayContaining([
          'contentChanged',
          'patternRelevantChanged',
          'symbolSurfaceChanged',
        ]),
        impactHints: expect.arrayContaining(['requiresPatternRefresh']),
      }),
    ]);
  });

  it('uses a conservative fallback when content changes are not classified semantically', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "before"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "after"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const changeSummary = await loadPersistedChangeSummary();

    expect(result.diagnostics.changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/util.ts',
        confidence: 'low',
        signals: expect.arrayContaining(['contentChanged', 'unknownStructuralChange']),
        impactHints: expect.arrayContaining([
          'highRiskStructuralChange',
          'mayAffectSearchFreshness',
          'requiresGraphRebuild',
          'requiresPatternRefresh',
          'requiresSymbolReindex',
        ]),
      }),
    ]);
    expect(changeSummary.overview.highRiskFiles).toBe(1);
  });

  it('does not attach UI-specific signals to non-UI file changes', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/math.ts',
      'export function sum(a: number, b: number): number { return a + b; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/math.ts',
      'export function subtract(a: number, b: number): number { return a - b; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const file = result.diagnostics.changeSummary.files[0];

    expect(file.key).toBe('app-repo/src/math.ts');
    expect(file.signals).not.toEqual(expect.arrayContaining(['uiStructureChanged', 'uiPropsChanged', 'uiRenderingChanged', 'uiStylingChanged']));
  });

  it('persists change summaries into the published generation state and artifact set', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "a"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function beta(): string { return "b"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();
    const changeSummary = await loadPersistedChangeSummary();

    expect(state?.changeSummary).toEqual(result.diagnostics.changeSummary.overview);
    expect(changeSummary.overview.filesChanged).toBe(1);
    expect(changeSummary.files).toEqual([
      expect.objectContaining({
        key: 'app-repo/src/a.ts',
        changeKind: 'modified',
      }),
    ]);
  });

  it('produces idempotent published artifacts across repeated refresh runs', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "a"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "updated"; }',
    );
    const second = await refreshIndexes(reposRoot, { logger: silentLogger });
    const third = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();

    expect(second.diagnostics.status).toBe('committed');
    expect(third.diagnostics.status).toBe('no-op');
    expect(third.diagnostics.generationId).toBe(second.diagnostics.generationId);
    expect(symbolIndex.symbols).toEqual([
      expect.objectContaining({
        name: 'alpha',
        filePath: 'src/a.ts',
      }),
    ]);
    expect(second.diagnostics.generationId).not.toBe(first.diagnostics.generationId);
  });

  it('does not publish a partially built generation when refresh fails before publish', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "stable"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function brokenPublishAttempt(): string { return "changed"; }',
    );

    await expect(
      refreshIndexes(reposRoot, { logger: silentLogger, failBeforePublish: true }),
    ).rejects.toThrow('Simulated refresh failure before publish.');

    const state = await loadCurrentGenerationState();
    const symbolIndex = await loadSymbolIndex();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
    expect(symbolIndex.symbols).toEqual([
      expect.objectContaining({
        name: 'stableName',
        filePath: 'src/util.ts',
      }),
    ]);
    expect(symbolIndex.symbols.find((symbol) => symbol.name === 'brokenPublishAttempt')).toBeUndefined();
  });
});
