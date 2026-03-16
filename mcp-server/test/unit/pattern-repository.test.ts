import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { runPatternExtractionStage } from '../../src/patterns/stage.js';
import {
  createPatternCandidate,
  getPatternById,
  getPatternsForFile,
  getPatternsForSymbol,
  listPatternsByKind,
  registerPatternCandidate,
} from '../../src/patterns/repository.js';
import { loadPatternIndex, savePatternIndex } from '../../src/patterns/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-pattern-repository-test-'));
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('pattern repository', () => {
  it('registers and queries deterministic pattern candidates', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const candidate = createPatternCandidate({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'repo-a:src/components/Button.tsx:function:Button:1',
      name: 'Button',
      language: 'tsx',
      startLine: 10,
      endLine: 42,
      signals: [
        { type: 'react-function-component', strength: 'strong', note: 'placeholder signal' },
      ],
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['renders-jsx'],
      },
      supportingImports: ['react', './Button.css'],
      relatedSymbolIds: ['repo-a:src/components/Button.tsx:typeAlias:ButtonProps:1'],
      confidence: 'medium',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await registerPatternCandidate(candidate);

    const loaded = await loadPatternIndex();
    const byId = await getPatternById(candidate.patternId);
    const byFile = await getPatternsForFile(candidate.fileId);
    const bySymbol = await getPatternsForSymbol(candidate.symbolId as string);
    const byKind = await listPatternsByKind('component');

    expect(loaded.patterns).toHaveLength(1);
    expect(byId).toEqual(candidate);
    expect(byFile).toEqual([candidate]);
    expect(bySymbol).toEqual([candidate]);
    expect(byKind).toEqual([candidate]);
  });

  it('loads empty pattern indexes and persists placeholder extraction output', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);
    const emptyReposRoot = path.join(tempRoot, 'repos');
    await fs.mkdir(emptyReposRoot, { recursive: true });

    const empty = await loadPatternIndex();

    expect(empty).toEqual({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 0,
      generatedAt: '',
      patterns: [],
    });

    const placeholder = await runPatternExtractionStage(emptyReposRoot, {
      schemaVersion: 4,
      symbols: [],
      byName: {},
      byNameLower: {},
      byFile: {},
      stats: {
        globalByName: {},
        globalByNameLower: {},
        byRepo: {},
        exportedByName: {},
        byKind: {},
      },
    });

    await savePatternIndex(placeholder);

    const reloaded = await loadPatternIndex();

    expect(reloaded.schemaVersion).toBe(1);
    expect(reloaded.sourceSymbolIndexSchemaVersion).toBe(4);
    expect(reloaded.patterns).toEqual([]);
    expect(reloaded.generatedAt).toMatch(/T/);
  });

  it('extracts deterministic patterns for ts and tsx files', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'pattern-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'hooks'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'lib'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'utils'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'api'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', '__tests__'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'stories'), { recursive: true });

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'Button.tsx'),
      [
        "import { useMemo } from 'react';",
        '',
        'export function Button({ items, showExtra }: { items: string[]; showExtra: boolean }) {',
        '  const values = useMemo(() => items, [items]);',
        '  return (',
        '    <section>',
        '      {showExtra && <span>Extra</span>}',
        '      {values.map((item) => <span key={item}>{item}</span>)}',
        '    </section>',
        '  );',
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'hooks', 'useAudio.ts'),
      [
        "import { useEffect, useState } from 'react';",
        '',
        'export function useAudio() {',
        "  const [status, setStatus] = useState('idle');",
        '  useEffect(() => {',
        "    setStatus('ready');",
        '  }, []);',
        '  return status;',
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'lib', 'loadFeed.ts'),
      [
        "import { apiClient } from '../utils/apiClient';",
        '',
        'export async function loadFeed() {',
        '  try {',
        "    const response = await apiClient('/feed');",
        '    return response;',
        '  } catch (error) {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'utils', 'slugify.ts'),
      [
        'export function slugify(value: string) {',
        "  return value.toLowerCase().replace(/\\s+/g, '-');",
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'api', 'route.ts'),
      [
        "import { fetch } from '../utils/fetcher';",
        '',
        'export async function GET() {',
        "  return fetch('/api/feed');",
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', '__tests__', 'Button.test.tsx'),
      [
        "import { describe, it, expect } from 'vitest';",
        '',
        "describe('Button', () => {",
        "  it('renders', () => {",
        '    expect(true).toBe(true);',
        '  });',
        '});',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'stories', 'Button.stories.tsx'),
      [
        "import type { Meta } from '@storybook/react';",
        "import { Button } from '../components/Button';",
        '',
        'export default {',
        "  title: 'Button',",
        '  component: Button,',
        '} satisfies Meta<typeof Button>;',
      ].join('\n'),
      'utf8',
    );

    const symbolIndex = await buildIndexedSymbols(reposRoot);
    const patternIndex = await runPatternExtractionStage(reposRoot, symbolIndex);
    const patternsByKind = new Map(patternIndex.patterns.map((pattern) => [`${pattern.fileId}:${pattern.kind}`, pattern]));

    expect(patternIndex.schemaVersion).toBe(1);
    expect(patternIndex.sourceSymbolIndexSchemaVersion).toBe(symbolIndex.schemaVersion);

    const componentPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'component');
    const hookPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'hook');
    const asyncPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'async-data-flow');
    const listPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'list-rendering');
    const conditionalPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'conditional-rendering');
    const utilityPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'utility-export');
    const apiPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'api-handler');
    const testPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'test-suite');
    const storyPatterns = patternIndex.patterns.filter((pattern) => pattern.kind === 'storybook-story');

    expect(componentPatterns).toEqual([
      expect.objectContaining({
        name: 'Button',
        language: 'tsx',
        confidence: 'high',
        fingerprint: expect.objectContaining({
          patternKind: 'component',
          structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        }),
      }),
    ]);
    expect(hookPatterns).toEqual([
      expect.objectContaining({
        name: 'useAudio',
        fingerprint: expect.objectContaining({
          patternKind: 'hook',
          structuralSignals: ['custom-hook', 'uses-hooks'],
        }),
      }),
    ]);
    expect(asyncPatterns).toEqual([
      expect.objectContaining({
        name: 'loadFeed',
        confidence: 'high',
        fingerprint: expect.objectContaining({
          patternKind: 'async-data-flow',
          structuralSignals: ['api-request', 'async-function', 'error-handling'],
        }),
      }),
    ]);
    expect(listPatterns).toEqual([
      expect.objectContaining({
        name: 'Button',
        fingerprint: expect.objectContaining({
          patternKind: 'list-rendering',
          structuralSignals: ['map-rendering'],
        }),
      }),
    ]);
    expect(conditionalPatterns).toEqual([
      expect.objectContaining({
        name: 'Button',
        fingerprint: expect.objectContaining({
          patternKind: 'conditional-rendering',
          structuralSignals: ['conditional-render'],
        }),
      }),
    ]);
    expect(utilityPatterns).toEqual([
      expect.objectContaining({
        name: 'slugify',
        language: 'ts',
        fingerprint: expect.objectContaining({
          patternKind: 'utility-export',
          structuralSignals: ['named-export'],
        }),
      }),
    ]);
    expect(apiPatterns).toEqual([
      expect.objectContaining({
        name: 'GET',
        fingerprint: expect.objectContaining({
          patternKind: 'api-handler',
          structuralSignals: ['api-request', 'async-function', 'route-handler'],
        }),
      }),
    ]);
    expect(testPatterns).toEqual([
      expect.objectContaining({
        name: 'Button.test',
        relatedSymbolIds: symbolIndex.byFile[Object.keys(symbolIndex.byFile).find((key) => symbolIndex.byFile[key].filePath === 'src/__tests__/Button.test.tsx') as string].symbolIds,
      }),
    ]);
    expect(storyPatterns).toEqual([
      expect.objectContaining({
        name: 'Button.stories',
        fingerprint: expect.objectContaining({
          patternKind: 'storybook-story',
          structuralSignals: ['storybook-meta'],
        }),
      }),
    ]);

    expect(patternIndex.patterns).toHaveLength(9);
    expect(patternsByKind.size).toBe(patternIndex.patterns.length);
  });
});
