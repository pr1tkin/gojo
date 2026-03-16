import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveUiCompositionIndex } from '../../src/ui-composition/store.js';
import { saveUiPropSurfaceIndex } from '../../src/ui-props/store.js';
import {
  getObservedPropNamesForComponent,
  getUiChildrenForComponent,
  getUiHierarchySummary,
  getUiParentsForComponent,
} from '../../src/orchestrator/ui-hierarchy-service.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-ui-hierarchy-test-'));
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

describe('ui hierarchy service', () => {
  it('aggregates rendered children, parents, and observed props from the UI structure artifacts', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await saveUiCompositionIndex({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: new Date().toISOString(),
      edges: [
        {
          parentFilePath: 'src/app/page.tsx',
          parentSymbolId: 'repo-a:src/app/page.tsx:function:Page:1',
          parentSymbolName: 'Page',
          childComponentName: 'AudioHero',
          childFilePath: 'src/components/AudioHero.tsx',
          childSymbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          source: 'jsx',
          confidence: 'high',
        },
        {
          parentFilePath: 'src/app/page.tsx',
          parentSymbolId: 'repo-a:src/app/page.tsx:function:Page:1',
          parentSymbolName: 'Page',
          childComponentName: 'Button',
          childFilePath: 'src/components/Button.tsx',
          childSymbolId: 'repo-a:src/components/Button.tsx:function:Button:1',
          source: 'jsx',
          confidence: 'high',
        },
        {
          parentFilePath: 'src/features/podcast/PodcastPage.tsx',
          parentSymbolId: 'repo-a:src/features/podcast/PodcastPage.tsx:function:PodcastPage:1',
          parentSymbolName: 'PodcastPage',
          childComponentName: 'AudioHero',
          childFilePath: 'src/components/AudioHero.tsx',
          childSymbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          source: 'jsx',
          confidence: 'high',
        },
      ],
    });
    await saveUiPropSurfaceIndex({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: new Date().toISOString(),
      propUsages: [
        {
          parentFilePath: 'src/app/page.tsx',
          parentSymbolId: 'repo-a:src/app/page.tsx:function:Page:1',
          parentSymbolName: 'Page',
          childComponentName: 'AudioHero',
          childFilePath: 'src/components/AudioHero.tsx',
          childSymbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          propName: 'title',
          valueKind: 'string-literal',
          source: 'jsx-attribute',
          confidence: 'high',
        },
        {
          parentFilePath: 'src/app/page.tsx',
          parentSymbolId: 'repo-a:src/app/page.tsx:function:Page:1',
          parentSymbolName: 'Page',
          childComponentName: 'AudioHero',
          childFilePath: 'src/components/AudioHero.tsx',
          childSymbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          propName: 'image',
          valueKind: 'identifier',
          source: 'jsx-attribute',
          confidence: 'high',
        },
        {
          parentFilePath: 'src/features/podcast/PodcastPage.tsx',
          parentSymbolId: 'repo-a:src/features/podcast/PodcastPage.tsx:function:PodcastPage:1',
          parentSymbolName: 'PodcastPage',
          childComponentName: 'AudioHero',
          childFilePath: 'src/components/AudioHero.tsx',
          childSymbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          propName: 'title',
          valueKind: 'expression',
          source: 'jsx-attribute',
          confidence: 'high',
        },
      ],
    });

    const children = await getUiChildrenForComponent({
      filePath: 'src/app/page.tsx',
      symbolId: 'repo-a:src/app/page.tsx:function:Page:1',
      symbolName: 'Page',
    });
    const parents = await getUiParentsForComponent({
      filePath: 'src/components/AudioHero.tsx',
      symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
      symbolName: 'AudioHero',
    });
    const props = await getObservedPropNamesForComponent({
      filePath: 'src/components/AudioHero.tsx',
      symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
      symbolName: 'AudioHero',
    });
    const summary = await getUiHierarchySummary({
      filePath: 'src/components/AudioHero.tsx',
      symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
      symbolName: 'AudioHero',
    });

    expect(children).toEqual([
      {
        componentName: 'AudioHero',
        filePath: 'src/components/AudioHero.tsx',
        symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
        resolved: true,
      },
      {
        componentName: 'Button',
        filePath: 'src/components/Button.tsx',
        symbolId: 'repo-a:src/components/Button.tsx:function:Button:1',
        resolved: true,
      },
    ]);
    expect(parents).toEqual([
      {
        componentName: 'Page',
        filePath: 'src/app/page.tsx',
        symbolId: 'repo-a:src/app/page.tsx:function:Page:1',
        resolved: true,
      },
      {
        componentName: 'PodcastPage',
        filePath: 'src/features/podcast/PodcastPage.tsx',
        symbolId: 'repo-a:src/features/podcast/PodcastPage.tsx:function:PodcastPage:1',
        resolved: true,
      },
    ]);
    expect(props).toEqual([
      { propName: 'title', count: 2 },
      { propName: 'image', count: 1 },
    ]);
    expect(summary).toEqual({
      target: {
        filePath: 'src/components/AudioHero.tsx',
        symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
        symbolName: 'AudioHero',
      },
      renders: [],
      renderedBy: [
        {
          componentName: 'Page',
          filePath: 'src/app/page.tsx',
          symbolId: 'repo-a:src/app/page.tsx:function:Page:1',
          resolved: true,
        },
        {
          componentName: 'PodcastPage',
          filePath: 'src/features/podcast/PodcastPage.tsx',
          symbolId: 'repo-a:src/features/podcast/PodcastPage.tsx:function:PodcastPage:1',
          resolved: true,
        },
      ],
      observedProps: [
        { propName: 'title', count: 2 },
        { propName: 'image', count: 1 },
      ],
    });
  });

  it('returns null and empty helper results when no UI hierarchy signals exist', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await saveUiCompositionIndex({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: '',
      edges: [],
    });
    await saveUiPropSurfaceIndex({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: '',
      propUsages: [],
    });

    const input = {
      filePath: 'src/components/Missing.tsx',
      symbolId: 'repo-a:src/components/Missing.tsx:function:Missing:1',
      symbolName: 'Missing',
    };

    expect(await getUiChildrenForComponent(input)).toEqual([]);
    expect(await getUiParentsForComponent(input)).toEqual([]);
    expect(await getObservedPropNamesForComponent(input)).toEqual([]);
    expect(await getUiHierarchySummary(input)).toBeNull();
  });
});
