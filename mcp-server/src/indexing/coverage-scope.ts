import path from 'node:path';

import { classifyFile } from '../symbol-index/file-classification.js';
import type {
  SearchRepoCoverageScopeSummary,
  SearchVisibleCoverageExclusionCategory,
} from './types.js';

const FIXTURE_SEGMENTS = new Set([
  '__fixtures__',
  '__snapshots__',
  'fixture',
  'fixtures',
  'snapshot',
  'snapshots',
]);

const STYLE_OR_ASSET_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.css',
  '.eot',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.less',
  '.mp3',
  '.mp4',
  '.otf',
  '.pdf',
  '.png',
  '.sass',
  '.scss',
  '.svg',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

const DATA_OR_CONFIG_EXTENSIONS = new Set([
  '.conf',
  '.env',
  '.graphql',
  '.gql',
  '.ini',
  '.json',
  '.json5',
  '.jsonc',
  '.lock',
  '.toml',
  '.yaml',
  '.yml',
]);

const DATA_OR_CONFIG_FILE_NAMES = new Set([
  '.env',
  '.env.example',
  '.env.local',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const DOCUMENTATION_EXTENSIONS = new Set([
  '.adoc',
  '.md',
  '.mdx',
  '.rst',
  '.txt',
]);

const TEMPLATE_OR_MARKUP_EXTENSIONS = new Set([
  '.astro',
  '.hbs',
  '.handlebars',
  '.html',
  '.htm',
  '.liquid',
  '.njk',
  '.svelte',
  '.twig',
  '.vue',
  '.xml',
]);

export interface SearchVisibleFileScopeClassification {
  category: 'relevant_source' | SearchVisibleCoverageExclusionCategory;
  countsTowardRelevantSource: boolean;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isRelevantSourceFile(filePath: string): boolean {
  return classifyFile('__coverage__', filePath).classification === 'source';
}

export function classifySearchVisibleFileScope(
  relativePath: string,
): SearchVisibleFileScopeClassification {
  const normalizedPath = normalizeRelativePath(relativePath);
  const lowerPath = normalizedPath.toLowerCase();
  const extension = path.extname(lowerPath);
  const fileName = lowerPath.split('/').pop() ?? '';
  const segments = lowerPath.split('/').filter(Boolean);

  if (isRelevantSourceFile(normalizedPath)) {
    return {
      category: 'relevant_source',
      countsTowardRelevantSource: true,
    };
  }

  if (segments.some((segment) => FIXTURE_SEGMENTS.has(segment)) || fileName.endsWith('.snap')) {
    return {
      category: 'fixture_or_snapshot',
      countsTowardRelevantSource: false,
    };
  }

  if (STYLE_OR_ASSET_EXTENSIONS.has(extension)) {
    return {
      category: 'style_or_asset',
      countsTowardRelevantSource: false,
    };
  }

  if (DATA_OR_CONFIG_EXTENSIONS.has(extension) || DATA_OR_CONFIG_FILE_NAMES.has(fileName)) {
    return {
      category: 'data_or_config',
      countsTowardRelevantSource: false,
    };
  }

  if (DOCUMENTATION_EXTENSIONS.has(extension)) {
    return {
      category: 'documentation',
      countsTowardRelevantSource: false,
    };
  }

  if (TEMPLATE_OR_MARKUP_EXTENSIONS.has(extension)) {
    return {
      category: 'template_or_markup',
      countsTowardRelevantSource: false,
    };
  }

  return {
    category: 'other_non_source',
    countsTowardRelevantSource: false,
  };
}

export function createCoverageScopeSummary(
  filePaths: Iterable<string>,
): SearchRepoCoverageScopeSummary {
  const excludedByCategory: SearchRepoCoverageScopeSummary['excludedByCategory'] = {};
  let rawSearchVisibleCount = 0;
  let relevantSourceCount = 0;
  let excludedVisibleCount = 0;

  for (const filePath of filePaths) {
    rawSearchVisibleCount += 1;
    const classification = classifySearchVisibleFileScope(filePath);

    if (classification.countsTowardRelevantSource) {
      relevantSourceCount += 1;
      continue;
    }

    excludedVisibleCount += 1;
    const exclusionCategory = classification.category as SearchVisibleCoverageExclusionCategory;
    excludedByCategory[exclusionCategory] =
      (excludedByCategory[exclusionCategory] ?? 0) + 1;
  }

  return {
    rawSearchVisibleCount,
    relevantSourceCount,
    excludedVisibleCount,
    excludedByCategory,
  };
}
