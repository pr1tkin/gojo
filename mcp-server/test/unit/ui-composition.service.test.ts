import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';
import { buildUiCompositionIndex } from '../../src/ui-composition/build-index.js';
import { getChildrenForComponent, getParentsForComponent } from '../../src/ui-composition/query.js';
import {
  getUiCompositionFilePath,
  loadUiCompositionIndex,
  saveUiCompositionIndex,
} from '../../src/ui-composition/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-ui-composition-test-'));
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

describe('ui composition indexing', () => {
  it('extracts JSX component composition edges conservatively and persists them', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'ui-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'app'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'components'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'jsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
          },
        },
      }),
      'utf8',
    );

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'app', 'page.tsx'),
      [
        "import { Header } from '../components/Header';",
        "import AudioHero from '../components/AudioHero';",
        "import { MetadataFooter } from '../components/MetadataFooter';",
        "import { MissingThing } from '@pkg/ui';",
        "import { AliasWidget } from '@/components/AliasWidget';",
        "import { BrokenCard } from '../components/BrokenCard';",
        "import * as Tabs from '../components/tabs';",
        "import { Menu } from 'antd';",
        '',
        'const CustomModalContext = {};',
        'export function Page() {',
        '  return (',
        '    <main>',
        '      <Header />',
        '      <AudioHero />',
        '      <section>',
        '        <MetadataFooter />',
        '        <MissingThing />',
        '        <AliasWidget />',
        '        <BrokenCard />',
        '        <LooseWidget />',
        '        <Tabs.List />',
        '        <Tabs.Panel />',
        '        <Menu.Item />',
        '        <CustomModalContext.Provider />',
        '        <Unknown.Slot />',
        '        <div><span /></div>',
        '      </section>',
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'Header.tsx'),
      'export function Header() { return <div />; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'AudioHero.tsx'),
      'export default function AudioHero() { return <section />; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'MetadataFooter.tsx'),
      'export const MetadataFooter = () => <footer />;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'BrokenCard.tsx'),
      'export default function BrokenCard() { return <article />; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'ButtonGroup.tsx'),
      [
        'function Button() { return <button />; }',
        'export function ButtonGroup() {',
        '  return <div><Button /></div>;',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'LegacyPanel.jsx'),
      [
        "import { Header } from './Header';",
        'export function LegacyPanel() {',
        '  return <Header />;',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'tabs.tsx'),
      [
        'export function List() { return <div />; }',
        'export function Trigger() { return <button />; }',
      ].join('\n'),
      'utf8',
    );

    const symbolIndex = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(symbolIndex);
    const uiCompositionIndex = await buildUiCompositionIndex(reposRoot, symbolIndex);
    await saveUiCompositionIndex(uiCompositionIndex);

    const loadedIndex = await loadUiCompositionIndex();
    const pageChildren = await getChildrenForComponent({
      filePath: 'src/app/page.tsx',
      symbolName: 'Page',
    });
    const headerParents = await getParentsForComponent({
      filePath: 'src/components/Header.tsx',
    });
    const buttonChildren = await getChildrenForComponent({
      filePath: 'src/components/ButtonGroup.tsx',
      symbolName: 'ButtonGroup',
    });

    expect(getUiCompositionFilePath()).toBe(path.join(tempRoot, '.data', 'ui-composition.json'));
    expect(loadedIndex.schemaVersion).toBe(3);
    expect(loadedIndex.sourceSymbolIndexSchemaVersion).toBe(symbolIndex.schemaVersion);
    expect(loadedIndex.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Header',
        childFilePath: 'src/components/Header.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-repo', 'src/components/Header.tsx'),
          'function',
          'Header',
          1,
        ),
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'AudioHero',
        childFilePath: 'src/components/AudioHero.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-repo', 'src/components/AudioHero.tsx'),
          'function',
          'AudioHero',
          1,
        ),
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'MetadataFooter',
        childFilePath: 'src/components/MetadataFooter.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-repo', 'src/components/MetadataFooter.tsx'),
          'variable',
          'MetadataFooter',
          1,
        ),
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'MissingThing',
        resolution: 'external_dependency',
        dependencySource: '@pkg/ui',
        source: 'jsx',
        confidence: 'medium',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'AliasWidget',
        resolution: 'alias_not_resolved',
        hint: '@/components/AliasWidget',
        source: 'jsx',
        confidence: 'medium',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'BrokenCard',
        childFilePath: 'src/components/BrokenCard.tsx',
        resolution: 'missing_symbol',
        hint: '../components/BrokenCard',
        source: 'jsx',
        confidence: 'medium',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'LooseWidget',
        resolution: 'unresolved',
        source: 'jsx',
        confidence: 'medium',
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Tabs.List',
        childFilePath: 'src/components/tabs.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-repo', 'src/components/tabs.tsx'),
          'function',
          'List',
          1,
        ),
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
        memberExpression: {
          expression: 'Tabs.List',
          baseName: 'Tabs',
          members: ['List'],
          resolutionKind: 'resolved_local_member',
        },
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Tabs.Panel',
        resolution: 'unresolved',
        source: 'jsx',
        confidence: 'medium',
        hint: '../components/tabs',
        memberExpression: {
          expression: 'Tabs.Panel',
          baseName: 'Tabs',
          members: ['Panel'],
          resolutionKind: 'unresolved_member',
        },
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Menu.Item',
        resolution: 'external_dependency',
        dependencySource: 'antd',
        source: 'jsx',
        confidence: 'medium',
        memberExpression: {
          expression: 'Menu.Item',
          baseName: 'Menu',
          members: ['Item'],
          resolutionKind: 'external_dependency_member',
        },
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'CustomModalContext.Provider',
        resolution: 'external_dependency',
        source: 'jsx',
        confidence: 'medium',
        memberExpression: {
          expression: 'CustomModalContext.Provider',
          baseName: 'CustomModalContext',
          members: ['Provider'],
          resolutionKind: 'framework_member',
        },
      }),
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Unknown.Slot',
        resolution: 'unresolved',
        source: 'jsx',
        confidence: 'medium',
        memberExpression: {
          expression: 'Unknown.Slot',
          baseName: 'Unknown',
          members: ['Slot'],
          resolutionKind: 'unresolved_member',
        },
      }),
      expect.objectContaining({
        parentFilePath: 'src/components/ButtonGroup.tsx',
        parentSymbolName: 'ButtonGroup',
        childComponentName: 'Button',
        childFilePath: 'src/components/ButtonGroup.tsx',
        childSymbolId: createSymbolId(
          createFileId('ui-repo', 'src/components/ButtonGroup.tsx'),
          'function',
          'Button',
          1,
        ),
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
      }),
      expect.objectContaining({
        parentFilePath: 'src/components/LegacyPanel.jsx',
        parentSymbolName: 'LegacyPanel',
        childComponentName: 'Header',
        childFilePath: 'src/components/Header.tsx',
        resolution: 'resolved_local',
        source: 'jsx',
        confidence: 'high',
      }),
    ]));
    expect(loadedIndex.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ childComponentName: 'main' }),
      expect.objectContaining({ childComponentName: 'section' }),
      expect.objectContaining({ childComponentName: 'div' }),
      expect.objectContaining({ childComponentName: 'span' }),
    ]));
    expect(pageChildren.map((edge) => edge.childComponentName)).toEqual([
      'AliasWidget',
      'AudioHero',
      'BrokenCard',
      'CustomModalContext.Provider',
      'Header',
      'LooseWidget',
      'Menu.Item',
      'MetadataFooter',
      'MissingThing',
      'Tabs.List',
      'Tabs.Panel',
      'Unknown.Slot',
    ]);
    expect(headerParents).toEqual([
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Header',
      }),
      expect.objectContaining({
        parentFilePath: 'src/components/LegacyPanel.jsx',
        parentSymbolName: 'LegacyPanel',
        childComponentName: 'Header',
      }),
    ]);
    expect(buttonChildren).toEqual([
      expect.objectContaining({
        parentFilePath: 'src/components/ButtonGroup.tsx',
        parentSymbolName: 'ButtonGroup',
        childComponentName: 'Button',
      }),
    ]);
    expect(await getParentsForComponent({
      symbolId: createSymbolId(
        createFileId('ui-repo', 'src/components/tabs.tsx'),
        'function',
        'List',
        1,
      ),
    })).toEqual([
      expect.objectContaining({
        parentFilePath: 'src/app/page.tsx',
        parentSymbolName: 'Page',
        childComponentName: 'Tabs.List',
      }),
    ]);
  });

  it('returns safe empty query results when no UI composition snapshot exists', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    expect(await getChildrenForComponent({ filePath: 'src/app/page.tsx' })).toEqual([]);
    expect(await getParentsForComponent({ childComponentName: 'Header' })).toEqual([]);
  });
});
