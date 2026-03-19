import { describe, expect, it } from 'vitest';

import {
  classifySearchVisibleFileScope,
  createCoverageScopeSummary,
} from '../../src/indexing/coverage-scope.js';

describe('coverage scope classification', () => {
  it('classifies current JS and TS source files as relevant structural scope', () => {
    expect(classifySearchVisibleFileScope('src/components/Button.tsx')).toEqual({
      category: 'relevant_source',
      countsTowardRelevantSource: true,
    });

    expect(classifySearchVisibleFileScope('src/utils/request.js')).toEqual({
      category: 'relevant_source',
      countsTowardRelevantSource: true,
    });
  });

  it('classifies representative non-source paths into deterministic exclusion buckets', () => {
    expect(classifySearchVisibleFileScope('__fixtures__/api-response.json').category).toBe('fixture_or_snapshot');
    expect(classifySearchVisibleFileScope('src/components/Button.module.css').category).toBe('style_or_asset');
    expect(classifySearchVisibleFileScope('package-lock.json').category).toBe('data_or_config');
    expect(classifySearchVisibleFileScope('README.md').category).toBe('documentation');
    expect(classifySearchVisibleFileScope('templates/email.hbs').category).toBe('template_or_markup');
    expect(classifySearchVisibleFileScope('scripts/bootstrap.sh').category).toBe('other_non_source');
  });

  it('summarizes raw and relevant counts across mixed search-visible files', () => {
    expect(
      createCoverageScopeSummary([
        'src/App.tsx',
        'src/theme.css',
        'README.md',
        '__fixtures__/payload.json',
        'package-lock.json',
      ]),
    ).toEqual({
      rawSearchVisibleCount: 5,
      relevantSourceCount: 1,
      excludedVisibleCount: 4,
      excludedByCategory: {
        style_or_asset: 1,
        documentation: 1,
        fixture_or_snapshot: 1,
        data_or_config: 1,
      },
    });
  });
});
