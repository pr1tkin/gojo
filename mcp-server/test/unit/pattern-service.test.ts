import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getFileExplorationContextMock,
  getSymbolExplorationContextMock,
  getDefinedSymbolsMock,
  getExportedSymbolsMock,
  getFileNodeMock,
  getFileRelationMock,
  getFileRelationByIdMock,
  listFileRelationsMock,
} = vi.hoisted(() => ({
  getFileExplorationContextMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
  getDefinedSymbolsMock: vi.fn(),
  getExportedSymbolsMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getFileRelationMock: vi.fn(),
  getFileRelationByIdMock: vi.fn(),
  listFileRelationsMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/file-service.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
}));

vi.mock('../../src/orchestrator/symbol-service.js', () => ({
  getSymbolExplorationContext: getSymbolExplorationContextMock,
}));

vi.mock('../../src/graph/query.js', () => ({
  getDefinedSymbols: getDefinedSymbolsMock,
  getExportedSymbols: getExportedSymbolsMock,
  getFileNode: getFileNodeMock,
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  getFileRelation: getFileRelationMock,
  getFileRelationById: getFileRelationByIdMock,
  listFileRelations: listFileRelationsMock,
}));

import {
  getPatternMatchesForComponent,
  getPatternMatchesForFile,
  getPatternMatchesForSymbol,
} from '../../src/orchestrator/pattern-service.js';

const targetRelation = {
  fileId: 'repo-a:src/components/Button.tsx',
  repo: 'repo-a',
  filePath: 'src/components/Button.tsx',
  classification: 'source',
  symbolIds: ['button-symbol'],
  symbolNames: ['Button', 'ButtonProps'],
  imports: [
    {
      fileId: 'repo-a:src/components/Button.tsx',
      source: './Button.styles',
      bindings: [],
      resolvedKind: 'local-file',
      resolvedTargetFileId: 'repo-a:src/components/Button.styles.ts',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/Button.tsx',
      kind: 'named',
      exportedName: 'Button',
      localName: 'Button',
      symbolId: 'button-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
};

const candidateStrong = {
  fileId: 'repo-a:src/components/IconButton.tsx',
  repo: 'repo-a',
  filePath: 'src/components/IconButton.tsx',
  classification: 'source',
  symbolIds: ['icon-button-symbol'],
  symbolNames: ['IconButton', 'ButtonProps'],
  imports: [
    {
      fileId: 'repo-a:src/components/IconButton.tsx',
      source: './Button.styles',
      bindings: [],
      resolvedKind: 'local-file',
      resolvedTargetFileId: 'repo-a:src/components/Button.styles.ts',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/IconButton.tsx',
      kind: 'named',
      exportedName: 'Button',
      localName: 'IconButton',
      symbolId: 'icon-button-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: ['repo-a:src/components/Button.styles.ts'],
    localDependencyFamilyTokens: ['components', 'button', 'styles', 'src'],
  },
};

const candidateTestArtifactStrong = {
  fileId: 'repo-a:src/components/IconButton.test.tsx',
  repo: 'repo-a',
  filePath: 'src/components/IconButton.test.tsx',
  classification: 'source',
  symbolIds: ['icon-button-test-symbol'],
  symbolNames: ['IconButtonTest'],
  imports: [
    {
      fileId: 'repo-a:src/components/IconButton.test.tsx',
      source: './Button.styles',
      bindings: [],
      resolvedKind: 'local-file',
      resolvedTargetFileId: 'repo-a:src/components/Button.styles.ts',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/IconButton.test.tsx',
      kind: 'named',
      exportedName: 'IconButtonTest',
      localName: 'IconButtonTest',
      symbolId: 'icon-button-test-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: ['repo-a:src/components/Button.styles.ts'],
    localDependencyFamilyTokens: ['components', 'button', 'styles', 'src'],
  },
};

const candidatePeer = {
  fileId: 'repo-a:src/components/ButtonShell.tsx',
  repo: 'repo-a',
  filePath: 'src/components/ButtonShell.tsx',
  classification: 'source',
  symbolIds: ['button-shell-symbol'],
  symbolNames: ['ButtonShell', 'ButtonProps'],
  imports: [
    {
      fileId: 'repo-a:src/components/ButtonShell.tsx',
      source: './Button.styles',
      bindings: [],
      resolvedKind: 'local-file',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/ButtonShell.tsx',
      kind: 'named',
      exportedName: 'Button',
      localName: 'ButtonShell',
      symbolId: 'button-shell-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: [],
    localDependencyFamilyTokens: [],
  },
};

const candidateStoryPeer = {
  fileId: 'repo-a:src/components/IconButton.stories.tsx',
  repo: 'repo-a',
  filePath: 'src/components/IconButton.stories.tsx',
  classification: 'source',
  symbolIds: ['icon-button-story-symbol'],
  symbolNames: ['IconButtonStory'],
  imports: [
    {
      fileId: 'repo-a:src/components/IconButton.stories.tsx',
      source: './Button',
      bindings: [],
      resolvedKind: 'local-file',
      resolvedTargetFileId: 'repo-a:src/components/Button.tsx',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/IconButton.stories.tsx',
      kind: 'named',
      exportedName: 'IconButtonStory',
      localName: 'IconButtonStory',
      symbolId: 'icon-button-story-symbol',
    },
  ],
  importTokens: ['Button', 'Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: ['repo-a:src/components/Button.tsx'],
    localDependencyFamilyTokens: ['button', 'components', 'src'],
  },
};

const candidateWeak = {
  fileId: 'repo-a:src/forms/FormField.tsx',
  repo: 'repo-a',
  filePath: 'src/forms/FormField.tsx',
  classification: 'source',
  symbolIds: ['form-field-symbol'],
  symbolNames: ['FormField'],
  imports: [],
  exports: [
    {
      fileId: 'repo-a:src/forms/FormField.tsx',
      kind: 'named',
      exportedName: 'FormField',
      localName: 'FormField',
      symbolId: 'form-field-symbol',
    },
  ],
  importTokens: ['react'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: [],
    localDependencyFamilyTokens: [],
  },
};

const candidateNoise = {
  fileId: 'repo-a:src/misc/Noise.ts',
  repo: 'repo-a',
  filePath: 'src/misc/Noise.ts',
  classification: 'source',
  symbolIds: ['noise-symbol'],
  symbolNames: ['Noise'],
  imports: [],
  exports: [
    {
      fileId: 'repo-a:src/misc/Noise.ts',
      kind: 'named',
      exportedName: 'Noise',
      localName: 'Noise',
      symbolId: 'noise-symbol',
    },
  ],
  importTokens: ['react'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: [],
    localDependencyFamilyTokens: [],
  },
};

const candidateRoleMismatch = {
  fileId: 'repo-a:src/utils/buildButtonTokens.ts',
  repo: 'repo-a',
  filePath: 'src/utils/buildButtonTokens.ts',
  classification: 'source',
  symbolIds: ['button-utils-symbol'],
  symbolNames: ['buildButtonTokens'],
  imports: [
    {
      fileId: 'repo-a:src/utils/buildButtonTokens.ts',
      source: '../components/Button.styles',
      bindings: [],
      resolvedKind: 'local-file',
      resolvedTargetFileId: 'repo-a:src/components/Button.styles.ts',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/utils/buildButtonTokens.ts',
      kind: 'named',
      exportedName: 'buildButtonTokens',
      localName: 'buildButtonTokens',
      symbolId: 'button-utils-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: ['repo-a:src/components/Button.styles.ts'],
    localDependencyFamilyTokens: ['components', 'button', 'styles', 'src'],
  },
};

const candidateTextHeavyLowAlignment = {
  fileId: 'repo-a:src/components/Button.stories.tsx',
  repo: 'repo-a',
  filePath: 'src/components/Button.stories.tsx',
  classification: 'source',
  symbolIds: ['button-stories-symbol'],
  symbolNames: ['ButtonStory'],
  imports: [
    {
      fileId: 'repo-a:src/components/Button.stories.tsx',
      source: './Button',
      bindings: [],
      resolvedKind: 'local-file',
    },
  ],
  exports: [
    {
      fileId: 'repo-a:src/components/Button.stories.tsx',
      kind: 'named',
      exportedName: 'Button',
      localName: 'ButtonStory',
      symbolId: 'button-stories-symbol',
    },
  ],
  importTokens: ['Button.styles', 'clsx'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: [],
    localDependencyFamilyTokens: [],
  },
};

const otherRepoCandidate = {
  fileId: 'repo-b:src/components/Button.tsx',
  repo: 'repo-b',
  filePath: 'src/components/Button.tsx',
  classification: 'source',
  symbolIds: ['repo-b-button'],
  symbolNames: ['Button'],
  imports: [],
  exports: [
    {
      fileId: 'repo-b:src/components/Button.tsx',
      kind: 'named',
      exportedName: 'Button',
      localName: 'Button',
      symbolId: 'repo-b-button',
    },
  ],
  importTokens: ['react'],
  structuralAnchor: {
    structurallyIndexed: true,
    resolvedLocalDependencyFileIds: [],
    localDependencyFamilyTokens: [],
  },
};

function fileNode(fileId: string, repoId: string, filePath: string) {
  return {
    nodeType: 'file' as const,
    fileId,
    repoId,
    filePath,
    classification: 'source' as const,
  };
}

function symbolNode(symbolId: string, fileId: string, repoId: string, filePath: string, name: string) {
  return {
    nodeType: 'symbol' as const,
    symbolId,
    fileId,
    repoId,
    filePath,
    name,
    kind: 'function' as const,
    exported: true,
    startLine: 1,
    endLine: 1,
  };
}

describe('pattern orchestrator service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listFileRelationsMock.mockResolvedValue([
      targetRelation,
      candidateStrong,
      candidateTestArtifactStrong,
      candidatePeer,
      candidateStoryPeer,
      candidateWeak,
      candidateNoise,
      candidateRoleMismatch,
      candidateTextHeavyLowAlignment,
      otherRepoCandidate,
    ]);
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      return [
        targetRelation,
        candidateStrong,
        candidateTestArtifactStrong,
        candidatePeer,
        candidateStoryPeer,
        candidateWeak,
        candidateNoise,
        candidateRoleMismatch,
        candidateTextHeavyLowAlignment,
        otherRepoCandidate,
      ].find((entry) => entry.fileId === fileId) ?? null;
    });
    getFileRelationMock.mockImplementation(async (filePath: string, repo?: string) => {
      const match = [
        targetRelation,
        candidateStrong,
        candidateTestArtifactStrong,
        candidatePeer,
        candidateStoryPeer,
        candidateWeak,
        candidateNoise,
        candidateRoleMismatch,
        candidateTextHeavyLowAlignment,
        otherRepoCandidate,
      ].find(
        (entry) => entry.filePath === filePath && (!repo || entry.repo === repo),
      );

      if (!match) {
        throw new Error('missing');
      }

      return match;
    });
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      const match = [
        targetRelation,
        candidateStrong,
        candidateTestArtifactStrong,
        candidatePeer,
        candidateStoryPeer,
        candidateWeak,
        candidateNoise,
        candidateRoleMismatch,
        candidateTextHeavyLowAlignment,
        otherRepoCandidate,
      ].find((entry) => entry.fileId === fileId);
      return match ? fileNode(match.fileId, match.repo, match.filePath) : null;
    });
    getDefinedSymbolsMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetRelation.fileId) {
        return [symbolNode('button-symbol', targetRelation.fileId, 'repo-a', targetRelation.filePath, 'Button')];
      }

      if (fileId === candidateStrong.fileId) {
        return [symbolNode('icon-button-symbol', candidateStrong.fileId, 'repo-a', candidateStrong.filePath, 'IconButton')];
      }

      if (fileId === candidateTestArtifactStrong.fileId) {
        return [symbolNode('icon-button-test-symbol', candidateTestArtifactStrong.fileId, 'repo-a', candidateTestArtifactStrong.filePath, 'IconButtonTest')];
      }

      if (fileId === candidatePeer.fileId) {
        return [symbolNode('button-shell-symbol', candidatePeer.fileId, 'repo-a', candidatePeer.filePath, 'ButtonShell')];
      }

      if (fileId === candidateStoryPeer.fileId) {
        return [symbolNode('icon-button-story-symbol', candidateStoryPeer.fileId, 'repo-a', candidateStoryPeer.filePath, 'IconButtonStory')];
      }

      if (fileId === candidateWeak.fileId) {
        return [symbolNode('form-field-symbol', candidateWeak.fileId, 'repo-a', candidateWeak.filePath, 'FormField')];
      }

      if (fileId === candidateNoise.fileId) {
        return [symbolNode('noise-symbol', candidateNoise.fileId, 'repo-a', candidateNoise.filePath, 'Noise')];
      }

      if (fileId === candidateRoleMismatch.fileId) {
        return [symbolNode('button-utils-symbol', candidateRoleMismatch.fileId, 'repo-a', candidateRoleMismatch.filePath, 'buildButtonTokens')];
      }

      if (fileId === candidateTextHeavyLowAlignment.fileId) {
        return [symbolNode('button-stories-symbol', candidateTextHeavyLowAlignment.fileId, 'repo-a', candidateTextHeavyLowAlignment.filePath, 'ButtonStory')];
      }

      return [symbolNode('repo-b-button', otherRepoCandidate.fileId, 'repo-b', otherRepoCandidate.filePath, 'Button')];
    });
    getExportedSymbolsMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetRelation.fileId) {
        return [symbolNode('button-symbol', targetRelation.fileId, 'repo-a', targetRelation.filePath, 'Button')];
      }

      if (fileId === candidateStrong.fileId) {
        return [symbolNode('icon-button-symbol', candidateStrong.fileId, 'repo-a', candidateStrong.filePath, 'Button')];
      }

      if (fileId === candidateTestArtifactStrong.fileId) {
        return [symbolNode('icon-button-test-symbol', candidateTestArtifactStrong.fileId, 'repo-a', candidateTestArtifactStrong.filePath, 'IconButtonTest')];
      }

      if (fileId === candidatePeer.fileId) {
        return [symbolNode('button-shell-symbol', candidatePeer.fileId, 'repo-a', candidatePeer.filePath, 'Button')];
      }

      if (fileId === candidateStoryPeer.fileId) {
        return [symbolNode('icon-button-story-symbol', candidateStoryPeer.fileId, 'repo-a', candidateStoryPeer.filePath, 'IconButtonStory')];
      }

      if (fileId === candidateWeak.fileId) {
        return [symbolNode('form-field-symbol', candidateWeak.fileId, 'repo-a', candidateWeak.filePath, 'FormField')];
      }

      if (fileId === candidateNoise.fileId) {
        return [symbolNode('noise-symbol', candidateNoise.fileId, 'repo-a', candidateNoise.filePath, 'Noise')];
      }

      if (fileId === candidateRoleMismatch.fileId) {
        return [symbolNode('button-utils-symbol', candidateRoleMismatch.fileId, 'repo-a', candidateRoleMismatch.filePath, 'buildButtonTokens')];
      }

      if (fileId === candidateTextHeavyLowAlignment.fileId) {
        return [symbolNode('button-stories-symbol', candidateTextHeavyLowAlignment.fileId, 'repo-a', candidateTextHeavyLowAlignment.filePath, 'Button')];
      }

      return [symbolNode('repo-b-button', otherRepoCandidate.fileId, 'repo-b', otherRepoCandidate.filePath, 'Button')];
    });
    getFileExplorationContextMock.mockImplementation(async (fileId: string) => ({
      fileId,
      primaryFile: fileNode(fileId, fileId.startsWith('repo-b:') ? 'repo-b' : 'repo-a', fileId.split(':')[1]),
      repo: fileId.startsWith('repo-b:') ? 'repo-b' : 'repo-a',
      relatedFiles:
        fileId === targetRelation.fileId
          ? [
              {
                file: fileNode('repo-a:src/components/Button.styles.ts', 'repo-a', 'src/components/Button.styles.ts'),
                score: 18,
                reason: 'direct import',
                reasons: [{ signal: 'graph_connection', value: 9 }],
                via: ['file_imports_file'],
              },
              ]
          : fileId === candidateStrong.fileId
            ? [
                {
                  file: fileNode('repo-a:src/components/Button.styles.ts', 'repo-a', 'src/components/Button.styles.ts'),
                  score: 14,
                  reason: 'direct import',
                  reasons: [{ signal: 'graph_connection', value: 7 }],
                    via: ['file_imports_file'],
                  },
                ]
            : fileId === candidateTestArtifactStrong.fileId
              ? [
                  {
                    file: fileNode('repo-a:src/components/Button.styles.ts', 'repo-a', 'src/components/Button.styles.ts'),
                    score: 13,
                    reason: 'direct import',
                    reasons: [{ signal: 'graph_connection', value: 6 }],
                    via: ['file_imports_file'],
                  },
                ]
            : fileId === candidateRoleMismatch.fileId
              ? [
                  {
                    file: fileNode('repo-a:src/components/Button.styles.ts', 'repo-a', 'src/components/Button.styles.ts'),
                    score: 12,
                    reason: 'direct import',
                    reasons: [{ signal: 'graph_connection', value: 6 }],
                    via: ['file_imports_file'],
                  },
                ]
              : fileId === candidateStoryPeer.fileId
                ? [
                    {
                      file: fileNode('repo-a:src/components/Button.tsx', 'repo-a', 'src/components/Button.tsx'),
                      score: 12,
                      reason: 'direct import',
                      reasons: [{ signal: 'graph_connection', value: 6 }],
                      via: ['file_imports_file'],
                    },
                  ]
          : [],
      neighboringFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: fileId === targetRelation.fileId ? 1 : 0,
        neighboringFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    }));
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: 'repo-a',
      kind: undefined,
      primarySymbol: {
        symbolId: 'button-symbol',
        fileId: targetRelation.fileId,
        name: 'Button',
        kind: 'function',
        repo: 'repo-a',
        filePath: targetRelation.filePath,
        startLine: 1,
        endLine: 5,
        exported: true,
      },
      primaryFile: fileNode(targetRelation.fileId, 'repo-a', targetRelation.filePath),
      rankedSymbols: [
        {
          item: {
            symbolId: 'button-symbol',
            fileId: targetRelation.fileId,
            name: 'Button',
            kind: 'function',
            repo: 'repo-a',
            filePath: targetRelation.filePath,
            startLine: 1,
            endLine: 5,
            exported: true,
          },
          score: 15,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
        {
          item: {
            symbolId: 'repo-b-button',
            fileId: otherRepoCandidate.fileId,
            name: 'Button',
            kind: 'function',
            repo: 'repo-b',
            filePath: otherRepoCandidate.filePath,
            startLine: 1,
            endLine: 5,
            exported: true,
          },
          score: 9,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [symbolNode('button-symbol', targetRelation.fileId, 'repo-a', targetRelation.filePath, 'Button')],
      summary: {
        candidateCount: 2,
        relatedFileCount: 0,
        exportedSymbolCount: 1,
      },
      rawContext: {},
    });
  });

  it('finds similar component-style files with stable ranking and explainable reasons', async () => {
    const result = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 6 });

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'repo-a',
      limit: 6,
      relatedLimit: 20,
    });
    expect(result.resolution).toEqual(
      expect.objectContaining({
        status: 'resolved',
        mode: 'component',
        candidateCount: 2,
        ambiguityDetected: true,
      }),
    );
    expect(result.patternMatches[0]).toEqual(
      expect.objectContaining({
        file: expect.objectContaining({ fileId: candidateStrong.fileId }),
        reason: 'runtime precedent with shared dependencies',
        structuralAlignment: expect.objectContaining({
          graphAnchored: true,
          structuralContextStrength: 'high',
          resolvedLocalDependencies: ['src/components/Button.styles.ts'],
        }),
      }),
    );
    expect(result.patternMatches[0].reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'structural_alignment', note: 'high' }),
        expect.objectContaining({ signal: 'dependency_overlap' }),
        expect.objectContaining({ signal: 'shared_local_dependencies' }),
        expect.objectContaining({ signal: 'responsibility_similarity' }),
        expect.objectContaining({ signal: 'runtime_role_bonus', note: 'component' }),
      ]),
    );
    expect(result.patternMatches[0].score).toBeGreaterThan(result.patternMatches[1].score);
    const lowAlignmentMatch = result.patternMatches.find(
      (match) => match.file.fileId === candidatePeer.fileId,
    );
    expect(lowAlignmentMatch).toEqual(
      expect.objectContaining({
        file: expect.objectContaining({ fileId: candidatePeer.fileId }),
        structuralAlignment: expect.objectContaining({
          graphAnchored: false,
          structuralContextStrength: 'low',
        }),
      }),
    );
    expect(lowAlignmentMatch?.score).toBeLessThan(result.patternMatches[0].score);
    const testArtifactMatch = result.patternMatches.find(
      (match) => match.file.fileId === candidateTestArtifactStrong.fileId,
    );
    expect(testArtifactMatch).toEqual(
      expect.objectContaining({
        file: expect.objectContaining({ fileId: candidateTestArtifactStrong.fileId }),
        reasons: expect.arrayContaining([
          expect.objectContaining({ signal: 'artifact_deprioritized', note: 'test_artifact' }),
        ]),
      }),
    );
    expect(result.patternMatches.map((entry) => entry.file.fileId)).not.toContain(candidateNoise.fileId);
    expect(result.primaryTarget.structuralAlignment).toEqual(
      expect.objectContaining({
        graphAnchored: true,
        structuralContextStrength: 'high',
      }),
    );
    expect(result.summary.graphAnchoredMatchCount).toBe(4);
  });

  it('prioritizes structural alignment over superficial similarity', async () => {
    const result = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 5 });
    const rankedFileIds = result.patternMatches.map((entry) => entry.file.fileId);

    expect(rankedFileIds).not.toContain(candidateTextHeavyLowAlignment.fileId);
  });

  it('prefers same-responsibility matches when structural grounding is otherwise similar', async () => {
    const result = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 5 });
    const rankedFileIds = result.patternMatches.map((entry) => entry.file.fileId);

    expect(rankedFileIds.indexOf(candidateStrong.fileId)).toBeLessThan(
      rankedFileIds.indexOf(candidateRoleMismatch.fileId),
    );
  });

  it('prevents a strong test artifact from outranking a runtime component precedent', async () => {
    const result = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 6 });
    const rankedFileIds = result.patternMatches.map((entry) => entry.file.fileId);

    expect(rankedFileIds.indexOf(candidateStrong.fileId)).toBeLessThan(
      rankedFileIds.indexOf(candidateTestArtifactStrong.fileId),
    );
  });

  it('keeps non-runtime artifact precedents available when the query target is itself a story artifact', async () => {
    const result = await getPatternMatchesForFile(candidateTextHeavyLowAlignment.filePath, {
      repo: 'repo-a',
      limit: 6,
    });

    expect(result.patternMatches[0]).toEqual(
      expect.objectContaining({
        file: expect.objectContaining({ fileId: candidateStoryPeer.fileId }),
      }),
    );
    expect(result.patternMatches.map((entry) => entry.file.fileId)).toContain(candidateStrong.fileId);
  });

  it('retains a non-runtime artifact when no strong runtime alternative exists', async () => {
    listFileRelationsMock
      .mockResolvedValueOnce([targetRelation, candidateTestArtifactStrong])
      .mockResolvedValueOnce([targetRelation, candidateTestArtifactStrong]);
    getFileRelationByIdMock.mockResolvedValueOnce(targetRelation);

    const result = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 3 });

    expect(result.patternMatches).toHaveLength(1);
    expect(result.patternMatches[0]).toEqual(
      expect.objectContaining({
        file: expect.objectContaining({ fileId: candidateTestArtifactStrong.fileId }),
      }),
    );
  });

  it('returns a stable ranking order across repeated runs', async () => {
    const first = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 5 });
    const second = await getPatternMatchesForComponent('Button', { repo: 'repo-a', limit: 5 });

    expect(first.patternMatches.map((entry) => entry.file.fileId)).toEqual(
      second.patternMatches.map((entry) => entry.file.fileId),
    );
  });

  it('applies repo filtering to keep pattern matches in the requested repository', async () => {
    const result = await getPatternMatchesForSymbol('Button', { repo: 'repo-a', limit: 5 });

    expect(result.patternMatches.every((entry) => entry.file.repoId === 'repo-a')).toBe(true);
    expect(result.repo).toBe('repo-a');
  });

  it('degrades safely for missing file targets', async () => {
    getFileRelationMock.mockRejectedValueOnce(new Error('missing'));

    const result = await getPatternMatchesForFile('src/missing.tsx', { repo: 'repo-a' });

    expect(result).toEqual({
      query: 'src/missing.tsx',
      mode: 'file',
      repo: 'repo-a',
      primaryTarget: {
        file: null,
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: null,
      },
      patternMatches: [],
      resolution: {
        status: 'missing',
        mode: 'file',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    });
  });
});
