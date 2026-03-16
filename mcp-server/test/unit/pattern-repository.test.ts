import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

    const empty = await loadPatternIndex();

    expect(empty).toEqual({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 0,
      generatedAt: '',
      patterns: [],
    });

    const placeholder = await runPatternExtractionStage('C:/repos', {
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
});
