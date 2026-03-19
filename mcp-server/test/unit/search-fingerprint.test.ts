import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSearchRepoFingerprints,
  compareSearchFingerprintSets,
} from '../../src/indexing/search-fingerprint.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-search-fingerprint-test-'));
}

async function ensureRepository(reposRoot: string, repositoryId: string): Promise<void> {
  await fs.mkdir(path.join(reposRoot, repositoryId, '.git'), { recursive: true });
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

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('search fingerprint contract', () => {
  it('is stable across repeated runs for the same repository state', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/b.ts', 'export const b = 2;\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');

    const first = await buildSearchRepoFingerprints(reposRoot);
    const second = await buildSearchRepoFingerprints(reposRoot);

    expect(second).toEqual(first);
  });

  it('is insensitive to file creation order because paths are normalized and sorted', async () => {
    const leftRoot = await createTempDirectory();
    const rightRoot = await createTempDirectory();
    tempDirectories.push(leftRoot, rightRoot);
    const leftReposRoot = path.join(leftRoot, 'repos');
    const rightReposRoot = path.join(rightRoot, 'repos');

    await ensureRepository(leftReposRoot, 'app-repo');
    await ensureRepository(rightReposRoot, 'app-repo');

    await writeRepositoryFile(leftReposRoot, 'app-repo', 'src/b.ts', 'export const b = 2;\n');
    await writeRepositoryFile(leftReposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');

    await writeRepositoryFile(rightReposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');
    await writeRepositoryFile(rightReposRoot, 'app-repo', 'src/b.ts', 'export const b = 2;\n');

    const left = await buildSearchRepoFingerprints(leftReposRoot);
    const right = await buildSearchRepoFingerprints(rightReposRoot);

    expect(right).toEqual(left);
  });

  it('uses canonical byte-order sorting rather than locale-sensitive path ordering', async () => {
    const leftRoot = await createTempDirectory();
    const rightRoot = await createTempDirectory();
    tempDirectories.push(leftRoot, rightRoot);
    const leftReposRoot = path.join(leftRoot, 'repos');
    const rightReposRoot = path.join(rightRoot, 'repos');

    await ensureRepository(leftReposRoot, 'app-repo');
    await ensureRepository(rightReposRoot, 'app-repo');

    const files = [
      ['src/_alpha.ts', 'export const under = 1;\n'],
      ['src/-alpha.ts', 'export const dash = 1;\n'],
      ['src/0alpha.ts', 'export const zero = 1;\n'],
      ['src/alpha.ts', 'export const plain = 1;\n'],
    ] as const;

    for (const [relativePath, content] of files) {
      await writeRepositoryFile(leftReposRoot, 'app-repo', relativePath, content);
    }

    for (const [relativePath, content] of [...files].reverse()) {
      await writeRepositoryFile(rightReposRoot, 'app-repo', relativePath, content);
    }

    const left = await buildSearchRepoFingerprints(leftReposRoot);
    const right = await buildSearchRepoFingerprints(rightReposRoot);

    expect(right).toEqual(left);
  });

  it('ignores generated, temp, and excluded-path files', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');

    const baseline = await buildSearchRepoFingerprints(reposRoot);

    await writeRepositoryFile(reposRoot, 'app-repo', 'dist/bundle.js', 'compiled output');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/runtime.generated.js', 'export const generated = true;\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/Widget.generated.jsx', 'export const Generated = () => null;\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/vendor.min.js', 'window.app=function(){};');
    await writeRepositoryFile(reposRoot, 'app-repo', 'generated/api.generated.ts', 'export const generated = true;\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'types/index.d.ts', 'export declare const x: string;\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts.tmp', 'scratch');

    const next = await buildSearchRepoFingerprints(reposRoot);

    expect(next).toEqual(baseline);
  });

  it('records relevant-source scope counts alongside raw search-visible counts', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/App.tsx', 'export function App() { return null; }\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/styles.css', '.app { color: red; }\n');
    await writeRepositoryFile(reposRoot, 'app-repo', 'README.md', '# app\n');
    await writeRepositoryFile(reposRoot, 'app-repo', '__fixtures__/payload.json', '{"ok":true}\n');

    const result = await buildSearchRepoFingerprints(reposRoot);

    expect(result.repoFingerprints).toEqual([
      expect.objectContaining({
        repoId: 'app-repo',
        fileCount: 4,
        scope: {
          rawSearchVisibleCount: 4,
          relevantSourceCount: 1,
          excludedVisibleCount: 3,
          excludedByCategory: {
            style_or_asset: 1,
            documentation: 1,
            fixture_or_snapshot: 1,
          },
        },
      }),
    ]);
  });

  it('treats ignored directories case-insensitively under the canonical contract', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');
    const baseline = await buildSearchRepoFingerprints(reposRoot);

    await writeRepositoryFile(reposRoot, 'app-repo', 'Dist/bundle.js', 'compiled');
    await writeRepositoryFile(reposRoot, 'app-repo', 'NODE_MODULES/pkg/index.js', 'compiled');

    const next = await buildSearchRepoFingerprints(reposRoot);

    expect(next).toEqual(baseline);
  });

  it('changes when repository content changes and comparison reports precise mismatch reasons', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;\n');

    const before = await buildSearchRepoFingerprints(reposRoot);

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 2;\n');
    const after = await buildSearchRepoFingerprints(reposRoot);
    const comparison = compareSearchFingerprintSets(
      before.repoFingerprints,
      after.repoFingerprints,
      before.aggregateFingerprint,
      after.aggregateFingerprint,
    );

    expect(after.aggregateFingerprint).not.toBe(before.aggregateFingerprint);
    expect(comparison.equivalent).toBe(false);
    expect(comparison.summary).toContain('Repo "app-repo" fingerprint differs');
  });
});
