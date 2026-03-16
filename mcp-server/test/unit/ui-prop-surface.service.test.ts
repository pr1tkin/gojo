import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';
import { buildUiPropSurfaceIndex } from '../../src/ui-props/build-index.js';
import {
  getCommonPropNamesForComponent,
  getPropUsageForParent,
  getPropsPassedToComponent,
} from '../../src/ui-props/query.js';
import {
  getUiPropSurfaceFilePath,
  loadUiPropSurfaceIndex,
  saveUiPropSurfaceIndex,
} from '../../src/ui-props/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-ui-prop-surface-test-'));
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

describe('ui prop surface indexing', () => {
  it('extracts JSX prop usage conservatively and persists the prop surface artifact', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'ui-prop-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'app'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'components'), { recursive: true });

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'app', 'page.tsx'),
      [
        "import AudioHero from '../components/AudioHero';",
        "import { Button } from '../components/Button';",
        "import { UnknownWidget } from '@pkg/ui';",
        '',
        'export function Page() {',
        '  return (',
        '    <main className="shell">',
        '      <AudioHero title="Hero" image={heroImage} variant="large" priority selected={true} />',
        '      <Button onClick={() => go()} disabled count={3} settings={{ mode: "x" }} items={[heroImage]} />',
        '      <UnknownWidget data={widgetData} />',
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'AudioHero.tsx'),
      'export default function AudioHero() { return <section />; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'Button.tsx'),
      'export function Button() { return <button />; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'Wrapper.tsx'),
      [
        'function Badge() { return <span />; }',
        'export function Wrapper() {',
        '  return <Badge tone="info" ready />;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const symbolIndex = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(symbolIndex);
    const uiPropSurfaceIndex = await buildUiPropSurfaceIndex(reposRoot, symbolIndex);
    await saveUiPropSurfaceIndex(uiPropSurfaceIndex);

    const loadedIndex = await loadUiPropSurfaceIndex();
    const audioHeroProps = await getPropsPassedToComponent({
      filePath: 'src/components/AudioHero.tsx',
    });
    const pagePropUsage = await getPropUsageForParent({
      filePath: 'src/app/page.tsx',
      symbolName: 'Page',
    });
    const wrapperProps = await getPropsPassedToComponent({
      filePath: 'src/components/Wrapper.tsx',
      childComponentName: 'Badge',
    });
    const buttonCommonProps = await getCommonPropNamesForComponent({
      filePath: 'src/components/Button.tsx',
    });

    expect(getUiPropSurfaceFilePath()).toBe(path.join(tempRoot, '.data', 'ui-props.json'));
    expect(loadedIndex.schemaVersion).toBe(1);
    expect(loadedIndex.sourceSymbolIndexSchemaVersion).toBe(symbolIndex.schemaVersion);
    expect(loadedIndex.propUsages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'AudioHero',
        childFilePath: 'src/components/AudioHero.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-prop-repo', 'src/components/AudioHero.tsx'),
          'function',
          'AudioHero',
          1,
        ),
        propName: 'title',
        valueKind: 'string-literal',
        source: 'jsx-attribute',
        confidence: 'high',
      }),
      expect.objectContaining({
        childComponentName: 'AudioHero',
        propName: 'image',
        valueKind: 'identifier',
      }),
      expect.objectContaining({
        childComponentName: 'AudioHero',
        propName: 'priority',
        valueKind: 'boolean-literal',
      }),
      expect.objectContaining({
        childComponentName: 'AudioHero',
        propName: 'selected',
        valueKind: 'boolean-literal',
      }),
      expect.objectContaining({
        childComponentName: 'Button',
        childFilePath: 'src/components/Button.tsx',
        propName: 'onClick',
        valueKind: 'expression',
      }),
      expect.objectContaining({
        childComponentName: 'Button',
        propName: 'count',
        valueKind: 'number-literal',
      }),
      expect.objectContaining({
        childComponentName: 'Button',
        propName: 'settings',
        valueKind: 'object',
      }),
      expect.objectContaining({
        childComponentName: 'Button',
        propName: 'items',
        valueKind: 'array',
      }),
      expect.objectContaining({
        childComponentName: 'UnknownWidget',
        propName: 'data',
        valueKind: 'identifier',
        confidence: 'medium',
      }),
      expect.objectContaining({
        parentFilePath: 'src/components/Wrapper.tsx',
        parentSymbolName: 'Wrapper',
        childComponentName: 'Badge',
        childFilePath: 'src/components/Wrapper.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-prop-repo', 'src/components/Wrapper.tsx'),
          'function',
          'Badge',
          1,
        ),
        propName: 'tone',
        valueKind: 'string-literal',
        confidence: 'high',
      }),
      expect.objectContaining({
        parentFilePath: 'src/components/Wrapper.tsx',
        childComponentName: 'Badge',
        propName: 'ready',
        valueKind: 'boolean-literal',
      }),
    ]));
    expect(loadedIndex.propUsages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        childComponentName: 'main',
        propName: 'className',
      }),
    ]));
    expect(audioHeroProps.map((usage) => usage.propName)).toEqual([
      'image',
      'priority',
      'selected',
      'title',
      'variant',
    ]);
    expect(pagePropUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ childComponentName: 'AudioHero', propName: 'title' }),
      expect.objectContaining({ childComponentName: 'Button', propName: 'disabled' }),
      expect.objectContaining({ childComponentName: 'UnknownWidget', propName: 'data' }),
    ]));
    expect(wrapperProps.map((usage) => usage.propName)).toEqual(['ready', 'tone']);
    expect(buttonCommonProps).toEqual([
      { propName: 'count', count: 1 },
      { propName: 'disabled', count: 1 },
      { propName: 'items', count: 1 },
      { propName: 'onClick', count: 1 },
      { propName: 'settings', count: 1 },
    ]);
  });

  it('returns safe empty query results when no prop surface snapshot exists', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    expect(await getPropsPassedToComponent({ childComponentName: 'AudioHero' })).toEqual([]);
    expect(await getPropUsageForParent({ filePath: 'src/app/page.tsx' })).toEqual([]);
    expect(await getCommonPropNamesForComponent({ childComponentName: 'Button' })).toEqual([]);
  });
});
