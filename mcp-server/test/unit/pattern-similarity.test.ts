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
    structuralAnchor: overrides.structuralAnchor,
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

  it('caps broad-pattern similarity when structural overlap is weak despite shared kind', () => {
    const pageComponent = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/PageLayout.tsx',
      symbolId: 'page-layout-symbol',
      name: 'PageLayout',
      language: 'tsx',
      startLine: 1,
      endLine: 40,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './layout.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const basicCard = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/BasicCard.tsx',
      symbolId: 'basic-card-symbol',
      name: 'BasicCard',
      language: 'tsx',
      startLine: 1,
      endLine: 18,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return'],
        importSet: ['react', './card.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([pageComponent, basicCard]));
    const score = service.computeSimilarityScore(pageComponent, basicCard);

    expect(score).toBeLessThanOrEqual(0.6);
  });

  it('uses import overlap to separate stronger same-kind matches', () => {
    const queryHook = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useCustomersQuery.ts',
      symbolId: 'customers-query-symbol',
      name: 'useCustomersQuery',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/types/api'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
    });
    const sameFamily = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useServersQuery.ts',
      symbolId: 'servers-query-symbol',
      name: 'useServersQuery',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/types/api'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
    });
    const genericHook = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useIntervalEffect.ts',
      symbolId: 'interval-effect-symbol',
      name: 'useIntervalEffect',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['dom-hook'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([queryHook, sameFamily, genericHook]));
    const sameFamilyScore = service.computeSimilarityScore(queryHook, sameFamily);
    const genericScore = service.computeSimilarityScore(queryHook, genericHook);

    expect(sameFamilyScore).toBeGreaterThan(genericScore);
  });

  it('uses responsibility signals to separate broad component families', () => {
    const rootLayout = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/app/layout.tsx',
      symbolId: 'root-layout-symbol',
      name: 'RootLayout',
      language: 'tsx',
      startLine: 1,
      endLine: 40,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react', 'next/font/google'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
        responsibilitySignals: ['layout-component'],
      },
    });
    const loginLayout = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/LoginLayout.tsx',
      symbolId: 'login-layout-symbol',
      name: 'LoginLayout',
      language: 'tsx',
      startLine: 1,
      endLine: 30,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react', 'next/font/google'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
        responsibilitySignals: ['layout-component'],
      },
    });
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
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
        responsibilitySignals: ['ui-control'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([rootLayout, loginLayout, button]));
    const layoutScore = service.computeSimilarityScore(rootLayout, loginLayout);
    const controlScore = service.computeSimilarityScore(rootLayout, button);

    expect(layoutScore).toBeGreaterThan(controlScore);
  });

  it('uses symbol-name similarity to favor natural same-family component neighbors', () => {
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
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
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
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });
    const contentSection = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/ContentSection.tsx',
      symbolId: 'content-section-symbol',
      name: 'ContentSection',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, iconButton, contentSection]));
    const buttonFamilyScore = service.computeSimilarityScore(button, iconButton);
    const genericComponentScore = service.computeSimilarityScore(button, contentSection);
    const neighbors = service.findSimilarPatterns(button.patternId, 3);

    expect(buttonFamilyScore).toBeGreaterThan(genericComponentScore);
    expect(neighbors[0]).toEqual(
      expect.objectContaining({
        patternId: iconButton.patternId,
      }),
    );
  });

  it('uses symbol-name similarity to cluster same-family broad-kind patterns more tightly', () => {
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
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
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
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
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
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });
    const contentSection = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/ContentSection.tsx',
      symbolId: 'content-section-symbol',
      name: 'ContentSection',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['next/image', './section.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });

    const service = createPatternSimilarityService(
      buildIndex([button, iconButton, primaryButton, contentSection]),
    );
    const clusters = service.buildClusters();
    const familyCluster = clusters.find((cluster) => cluster.memberPatternIds.includes(button.patternId));

    expect(familyCluster).toEqual(
      expect.objectContaining({
        patternKind: 'component',
        size: 3,
      }),
    );
    expect(familyCluster?.memberPatternIds).toEqual([
      button.patternId,
      iconButton.patternId,
      primaryButton.patternId,
    ]);
  });

  it('de-emphasizes same-file neighbors and low-representativeness helpers in nearest-neighbor results', () => {
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
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const localButtonBase = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/Button.tsx',
      symbolId: 'button-base-symbol',
      name: 'ButtonBase',
      language: 'tsx',
      startLine: 22,
      endLine: 34,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react', './button.css'],
        exportShape: 'none',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
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
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, localButtonBase, iconButton]));
    const matches = service.findSimilarPatterns(button.patternId, 3);

    expect(matches[0]).toEqual(
      expect.objectContaining({
        patternId: iconButton.patternId,
        similarityScore: 1,
      }),
    );
    expect(matches[1]).toEqual(
      expect.objectContaining({
        patternId: localButtonBase.patternId,
      }),
    );
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
        precedentFamily: 'ui_component',
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

  it('splits mixed runtime families into separate but related clusters', () => {
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
        importSet: ['react', '@/components/ui/button'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
        responsibilitySignals: ['ui-control'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['dep-a', 'dep-b'],
        localDependencyFamilyTokens: ['button', 'ui'],
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
        importSet: ['react', '@/components/ui/button'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
        responsibilitySignals: ['ui-control'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['dep-a', 'dep-b'],
        localDependencyFamilyTokens: ['button', 'ui'],
      },
    });
    const buttonContainer = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: 'repo-a:src/components/ButtonContainer.tsx',
      symbolId: 'button-container-symbol',
      name: 'ButtonContainer',
      language: 'tsx',
      startLine: 1,
      endLine: 28,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', '@/components/ui/button'],
        exportShape: 'named',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
        responsibilitySignals: ['layout-container'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['dep-a', 'dep-b'],
        localDependencyFamilyTokens: ['button', 'ui'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([button, iconButton, buttonContainer]));
    const clusters = service.buildClusters();
    const componentCluster = clusters.find((cluster) => cluster.memberPatternIds.includes(button.patternId));
    const wrapperCluster = clusters.find((cluster) => cluster.memberPatternIds.includes(buttonContainer.patternId));

    expect(componentCluster).toEqual(
      expect.objectContaining({
        precedentFamily: 'ui_component',
        memberPatternIds: [button.patternId, iconButton.patternId],
      }),
    );
    expect(wrapperCluster).toEqual(
      expect.objectContaining({
        precedentFamily: 'ui_wrapper_or_shell',
        memberPatternIds: [buttonContainer.patternId],
      }),
    );
    expect(componentCluster?.relatedClusterIds).toEqual([wrapperCluster?.clusterId]);
    expect(wrapperCluster?.relatedClusterIds).toEqual([componentCluster?.clusterId]);
  });

  it('isolates weak structurally disconnected members instead of keeping them in broad clusters', () => {
    const fetchUser = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/lib/fetchUser.ts',
      symbolId: 'fetch-user-symbol',
      name: 'fetchUser',
      language: 'ts',
      startLine: 1,
      endLine: 14,
      fingerprint: {
        patternKind: 'utility-export',
        structuralSignals: ['async-function', 'named-export'],
        importSet: ['@/lib/http', '@/lib/errors'],
        exportShape: 'named',
        symbolRole: 'utility',
        responsibilitySignals: ['api-client'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['http', 'errors'],
        localDependencyFamilyTokens: ['api', 'http'],
      },
    });
    const fetchAccount = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/lib/fetchAccount.ts',
      symbolId: 'fetch-account-symbol',
      name: 'fetchAccount',
      language: 'ts',
      startLine: 1,
      endLine: 14,
      fingerprint: {
        patternKind: 'utility-export',
        structuralSignals: ['async-function', 'named-export'],
        importSet: ['@/lib/http', '@/lib/errors'],
        exportShape: 'named',
        symbolRole: 'utility',
        responsibilitySignals: ['api-client'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['http', 'errors'],
        localDependencyFamilyTokens: ['api', 'http'],
      },
    });
    const slugify = makePattern({
      kind: 'utility-export',
      repoId: 'repo-a',
      fileId: 'repo-a:src/lib/slugify.ts',
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
        responsibilitySignals: ['string-helper'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: [],
        localDependencyFamilyTokens: [],
      },
    });

    const service = createPatternSimilarityService(buildIndex([fetchUser, fetchAccount, slugify]));
    const clusters = service.buildClusters();
    const fetchCluster = clusters.find((cluster) => cluster.memberPatternIds.includes(fetchUser.patternId));
    const slugifyCluster = clusters.find((cluster) => cluster.memberPatternIds.includes(slugify.patternId));

    expect(fetchCluster?.memberPatternIds).toEqual([fetchAccount.patternId, fetchUser.patternId]);
    expect(slugifyCluster?.memberPatternIds).toEqual([slugify.patternId]);
  });

  it('marks weaker but relevant members as peripheral', () => {
    const useBillingQuery = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useBillingQuery.ts',
      symbolId: 'billing-query-symbol',
      name: 'useBillingQuery',
      language: 'ts',
      startLine: 1,
      endLine: 24,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/api', '@/lib/auth'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        localDependencyFamilyTokens: ['billing', 'query', 'api'],
      },
    });
    const useOrdersQuery = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useOrdersQuery.ts',
      symbolId: 'orders-query-symbol',
      name: 'useOrdersQuery',
      language: 'ts',
      startLine: 1,
      endLine: 24,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/api', '@/lib/auth'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
      structuralAnchor: {
        structurallyIndexed: true,
        resolvedLocalDependencyFileIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        localDependencyFamilyTokens: ['orders', 'query', 'api'],
      },
    });
    const useLegacyQuery = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: 'repo-a:src/hooks/useLegacyQuery.ts',
      symbolId: 'legacy-query-symbol',
      name: 'useLegacyQuery',
      language: 'ts',
      startLine: 1,
      endLine: 24,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['legacy-hook'],
      },
      structuralAnchor: {
        structurallyIndexed: false,
        resolvedLocalDependencyFileIds: ['a', 'b', 'c', 'x', 'y', 'z', 'q', 'r', 's', 't', 'u'],
        localDependencyFamilyTokens: ['legacy'],
      },
    });

    const service = createPatternSimilarityService(buildIndex([useBillingQuery, useOrdersQuery, useLegacyQuery]));
    const cluster = service.buildClusters(0.4)[0];

    expect(cluster.coreMemberPatternIds).toEqual([useBillingQuery.patternId, useOrdersQuery.patternId]);
    expect(cluster.peripheralMemberPatternIds).toEqual([useLegacyQuery.patternId]);
    expect(cluster.reason).toBe('shared hook/context dependencies');
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
    expect(debug).toContain('family=ui_component');
    expect(debug).toContain('reason: same component family');
    expect(debug).toContain('signals: jsx-return, react-function-component, uses-hooks');
    expect(debug).toContain('core: 2 peripheral: 0');
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
