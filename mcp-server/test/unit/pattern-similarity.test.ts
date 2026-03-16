import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPatternClusters,
  computePatternSimilarity,
  createEmptyPatternIndex,
  createPatternCandidate,
  createPatternSimilarityService,
  findSimilarPatterns,
  findSimilarPatternsForPattern,
  registerPatternCandidateInIndex,
  savePatternIndex,
  type PatternCandidate,
  type PatternFingerprint,
} from '../../src/patterns/index.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-pattern-similarity-test-'));
}

function makePattern(
  overrides: Partial<PatternCandidate> & {
    kind: PatternCandidate['kind'];
    repoId: string;
    fileId: string;
    name: string;
    language: PatternCandidate['language'];
    startLine: number;
    endLine: number;
    fingerprint: PatternFingerprint;
  },
): PatternCandidate {
  return createPatternCandidate({
    kind: overrides.kind,
    repoId: overrides.repoId,
    fileId: overrides.fileId,
    ...(overrides.symbolId ? { symbolId: overrides.symbolId } : {}),
    name: overrides.name,
    language: overrides.language,
    startLine: overrides.startLine,
    endLine: overrides.endLine,
    signals: overrides.signals ?? [],
    fingerprint: overrides.fingerprint,
    supportingImports: overrides.supportingImports ?? [],
    relatedSymbolIds: overrides.relatedSymbolIds ?? [],
    confidence: overrides.confidence ?? 'high',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  });
}

function buildIndex(patterns: PatternCandidate[]) {
  return patterns.reduce(
    (index, pattern) => registerPatternCandidateInIndex(index, pattern),
    createEmptyPatternIndex(4, '2026-01-01T00:00:00.000Z'),
  );
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

describe('pattern similarity', () => {
  it('scores same-kind structural matches higher than unrelated patterns', async () => {
    const button = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-symbol',
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/IconButton.tsx',
      symbolId: 'icon-button-symbol',
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 22,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const useButtonState = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useButtonState.ts',
      symbolId: 'use-button-state-symbol',
      name: 'useButtonState',
      language: 'ts',
      startLine: 1,
      endLine: 15,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, iconButton, useButtonState]));
    const similarScore = service.computeSimilarityScore(button, iconButton);
    const differentScore = service.computeSimilarityScore(button, useButtonState);

    expect(similarScore).toBe(1);
    expect(differentScore).toBe(0);
  });

  it('returns nearest same-kind neighbors in deterministic score order', () => {
    const button = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-symbol',
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './button.css'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/IconButton.tsx',
      symbolId: 'icon-button-symbol',
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 22,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './button.css'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const linkButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/LinkButton.tsx',
      symbolId: 'link-button-symbol',
      name: 'LinkButton',
      language: 'tsx',
      startLine: 1,
      endLine: 18,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['conditional-render', 'jsx-return', 'react-function-component'],
        importSet: ['next/link', 'react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['conditional-render', 'jsx-return'],
      },
    });
    const formatDate = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/utils/date.ts',
      symbolId: 'format-date-symbol',
      name: 'formatDate',
      language: 'ts',
      startLine: 1,
      endLine: 10,
      fingerprint: {
        patternKind: 'utility-export',
        structuralSignals: ['named-export'],
        importSet: [],
        exportShape: 'named',
        symbolRole: 'utility',
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, iconButton, linkButton, formatDate]));
    const matches = service.findSimilarPatterns(button.patternId, 3);

    expect(matches).toEqual([
      expect.objectContaining({
        patternId: iconButton.patternId,
        similarityScore: 1,
      }),
      expect.objectContaining({
        patternId: linkButton.patternId,
      }),
    ]);
    expect(matches).toHaveLength(2);
    expect(matches[1].similarityScore).toBeGreaterThan(0);
    expect(matches[1].similarityScore).toBeLessThan(matches[0].similarityScore);
  });

  it('clusters same-kind patterns with shared signals and keeps noisy utility exports isolated', () => {
    const button = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-symbol',
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/IconButton.tsx',
      symbolId: 'icon-button-symbol',
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 22,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const primaryButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/PrimaryButton.tsx',
      symbolId: 'primary-button-symbol',
      name: 'PrimaryButton',
      language: 'tsx',
      startLine: 1,
      endLine: 24,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const slugify = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/utils/slugify.ts',
      symbolId: 'slugify-symbol',
      name: 'slugify',
      language: 'ts',
      startLine: 1,
      endLine: 10,
      fingerprint: {
        patternKind: 'utility-export',
        structuralSignals: ['named-export'],
        importSet: [],
        exportShape: 'named',
        symbolRole: 'utility',
      },
    });
    const formatDate = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/utils/date.ts',
      symbolId: 'format-date-symbol',
      name: 'formatDate',
      language: 'ts',
      startLine: 1,
      endLine: 10,
      fingerprint: {
        patternKind: 'utility-export',
        structuralSignals: ['named-export'],
        importSet: [],
        exportShape: 'named',
        symbolRole: 'utility',
      },
    });

    const service = createPatternSimilarityService(
      buildIndex([button, iconButton, primaryButton, slugify, formatDate]),
    );
    const clusters = service.buildClusters();
    const componentCluster = clusters.find(
      (cluster) =>
        cluster.patternKind === 'component' &&
        cluster.memberPatternIds.includes(button.patternId),
    );
    const utilityClusterCount = clusters.filter((cluster) => cluster.patternKind === 'utility-export').length;

    expect(componentCluster).toEqual(
      expect.objectContaining({
        patternKind: 'component',
        size: 3,
        dominantSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
      }),
    );
    expect(componentCluster?.memberPatternIds).toEqual([
      button.patternId,
      iconButton.patternId,
      primaryButton.patternId,
    ]);
    expect(componentCluster?.representativePatternId).toBe(button.patternId);
    expect(utilityClusterCount).toBe(2);
  });

  it('formats cluster debug output with deterministic members and dominant signals', () => {
    const button = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-symbol',
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/IconButton.tsx',
      symbolId: 'icon-button-symbol',
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 22,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, iconButton]));
    const cluster = service.buildClusters()[0];
    const debug = service.formatClusterDebug(cluster);

    expect(debug).toContain('Cluster (component) size=2');
    expect(debug).toContain('signals: jsx-return, react-function-component, uses-hooks');
    expect(debug).toContain('- repo-a:src/components/Button.tsx -> Button');
    expect(debug).toContain('- repo-a:src/components/IconButton.tsx -> IconButton');
  });

  it('supports persisted nearest-neighbor and cluster queries', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const button = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-symbol',
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButton = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/IconButton.tsx',
      symbolId: 'icon-button-symbol',
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 22,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const index = buildIndex([button, iconButton]);

    await savePatternIndex(index);

    const similarPatterns = await findSimilarPatterns(button.patternId, 5);
    const lookup = await findSimilarPatternsForPattern(button.patternId, 5);
    const clusters = await buildPatternClusters();
    const directScore = await computePatternSimilarity(button, iconButton);

    expect(similarPatterns).toEqual([
      expect.objectContaining({
        patternId: iconButton.patternId,
        similarityScore: 1,
      }),
    ]);
    expect(lookup.pattern?.patternId).toBe(button.patternId);
    expect(lookup.similarPatterns).toEqual(similarPatterns);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual(
      expect.objectContaining({
        patternKind: 'component',
        size: 2,
      }),
    );
    expect(directScore).toBe(1);
  });
});
