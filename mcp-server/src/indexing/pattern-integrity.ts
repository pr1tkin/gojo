import path from 'node:path';

import type { PatternIndexLoadResult } from '../patterns/store.js';
import type { PatternIndex } from '../patterns/types.js';
import type { FileRelation, SymbolIndex } from '../symbol-index/types.js';
import type {
  GenerationChangeSummary,
  IndexGenerationState,
  PatternIntegrityAssessment,
  PatternIntegrityIssue,
} from './types.js';

function isPatternEligibleFile(relation: FileRelation): boolean {
  if (relation.classification !== 'source') {
    return false;
  }

  const extension = path.extname(relation.filePath).toLowerCase();
  return extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx';
}

function createIssue(
  code: string,
  severity: PatternIntegrityIssue['severity'],
  summary: string,
  details: string,
  recommendedAction: string,
): PatternIntegrityIssue {
  return {
    code,
    severity,
    summary,
    details,
    recommendedAction,
  };
}

export function evaluatePatternIntegrity(options: {
  checkedAt: string;
  symbolIndex: SymbolIndex;
  patternIndex: PatternIndex;
  previousGeneration: IndexGenerationState | null;
  previousPatternLoadResult: PatternIndexLoadResult | null;
  changeSummary: GenerationChangeSummary;
}): PatternIntegrityAssessment {
  const eligibleRelations = Object.values(options.symbolIndex.byFile).filter((relation) =>
    isPatternEligibleFile(relation),
  );
  const eligibleSourceFiles = eligibleRelations.length;
  const patternBearingFiles = new Set(options.patternIndex.patterns.map((pattern) => pattern.fileId)).size;
  const previousPatternCount = options.previousGeneration?.counts.patterns;
  const previousEligibleSourceFiles = options.previousGeneration?.counts.files;
  const changedFiles = options.changeSummary.overview.filesChanged;
  const issues: PatternIntegrityIssue[] = [];
  const previousPatternIntegrityWasTrusted =
    options.previousGeneration?.patternIntegrity?.status !== 'failed';

  if (options.previousPatternLoadResult && options.previousPatternLoadResult.status !== 'ok') {
    issues.push(
      createIssue(
        'previous-pattern-artifact-untrusted',
        'warning',
        'previous published pattern artifact is untrustworthy',
        `the previous pattern artifact at ${options.previousPatternLoadResult.path} was ${options.previousPatternLoadResult.status}: ${options.previousPatternLoadResult.reason}`,
        'rebuild pattern artifacts from the current symbol index and review the published generation for corruption',
      ),
    );
  }

  if (eligibleSourceFiles >= 25 && options.patternIndex.patterns.length <= 2) {
    issues.push(
      createIssue(
        'pattern-output-catastrophically-incomplete',
        'error',
        'pattern extraction output is catastrophically incomplete',
        `the current generation has ${eligibleSourceFiles} eligible source files but only ${options.patternIndex.patterns.length} pattern candidates`,
        'block publish and run a full pattern rebuild for the generation',
      ),
    );
  }

  if (
    previousPatternIntegrityWasTrusted &&
    typeof previousPatternCount === 'number' &&
    previousPatternCount >= 25 &&
    options.patternIndex.patterns.length <= Math.max(2, Math.floor(previousPatternCount * 0.1)) &&
    eligibleSourceFiles >= 10 &&
    changedFiles <= Math.max(10, Math.floor(eligibleSourceFiles * 0.25))
  ) {
    issues.push(
      createIssue(
        'pattern-count-catastrophic-regression',
        'error',
        'pattern count regressed catastrophically relative to the previous trusted generation',
        `pattern count fell from ${previousPatternCount} to ${options.patternIndex.patterns.length} while only ${changedFiles} files changed`,
        'block publish and investigate pattern extraction or artifact corruption before rebuilding the generation',
      ),
    );
  }

  if (
    previousPatternIntegrityWasTrusted &&
    typeof previousPatternCount === 'number' &&
    previousPatternCount >= 50 &&
    patternBearingFiles <= 2 &&
    eligibleSourceFiles >= 20
  ) {
    issues.push(
      createIssue(
        'pattern-bearing-files-collapse',
        'error',
        'pattern-bearing file coverage collapsed unexpectedly',
        `the previous generation had ${previousPatternCount} patterns, but the current generation only reports pattern-bearing data for ${patternBearingFiles} files across ${eligibleSourceFiles} eligible source files`,
        'block publish and run a full generation rebuild with pattern extraction diagnostics',
      ),
    );
  }

  if (
    eligibleSourceFiles >= 10 &&
    options.patternIndex.patterns.length === 0 &&
    previousPatternCount === undefined
  ) {
    issues.push(
      createIssue(
        'pattern-output-empty',
        'warning',
        'pattern extraction produced no candidates',
        `the repository has ${eligibleSourceFiles} eligible source files but pattern extraction produced no candidates`,
        'review whether the repository is genuinely pattern-sparse or whether pattern extraction needs investigation',
      ),
    );
  }

  const status =
    issues.some((issue) => issue.severity === 'error')
      ? 'failed'
      : issues.length > 0
        ? 'degraded'
        : 'trusted';

  return {
    status,
    checkedAt: options.checkedAt,
    totalPatterns: options.patternIndex.patterns.length,
    eligibleSourceFiles,
    patternBearingFiles,
    ...(typeof previousPatternCount === 'number' ? { previousPatternCount } : {}),
    ...(typeof previousEligibleSourceFiles === 'number' ? { previousEligibleSourceFiles } : {}),
    issues,
  };
}
