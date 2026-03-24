import type { CodeGraphSnapshot } from '../graph/types.js';
import type { PatternIndex } from '../patterns/types.js';
import type { SymbolIndex } from '../symbol-index/types.js';
import type { UiCompositionIndex } from '../ui-composition/types.js';
import type { UiPropSurfaceIndex } from '../ui-props/types.js';
import { evaluateCatastrophicCountRegressions, type CountRegressionIssue } from './count-regressions.js';
import type {
  GenerationChangeSummary,
  HighRiskRefreshValidationAssessment,
  HighRiskRefreshValidationIssue,
  IndexGenerationState,
  RepositoryFileChangeRecord,
} from './types.js';

const CORE_SHARED_SEGMENT_PATTERN = /(^|\/)(app|common|components|core|layout|providers|shared)(\/|$)/i;

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function createIssue(
  code: string,
  severity: HighRiskRefreshValidationIssue['severity'],
  summary: string,
  details: string,
  recommendedAction: string,
): HighRiskRefreshValidationIssue {
  return {
    code,
    severity,
    summary,
    details,
    recommendedAction,
  };
}

function findHighRiskTriggers(
  changeSummary: GenerationChangeSummary,
  current: IndexGenerationState,
): string[] {
  const triggers: string[] = [];
  const filesChanged = changeSummary.overview.filesChanged;
  const repoFiles = Math.max(current.counts.files, 1);
  const largeScaleThreshold = Math.max(10, Math.floor(repoFiles * 0.25));
  const coreSharedFiles = changeSummary.files.filter((file) => CORE_SHARED_SEGMENT_PATTERN.test(file.filePath));

  if ((changeSummary.overview.signalCounts.unknownStructuralChange ?? 0) > 0) {
    triggers.push(
      `${changeSummary.overview.signalCounts.unknownStructuralChange ?? 0} file change(s) were classified as unknownStructuralChange`,
    );
  }

  if (changeSummary.overview.highRiskFiles > 0) {
    triggers.push(`${changeSummary.overview.highRiskFiles} file change(s) were classified as highRiskStructuralChange`);
  }

  if ((changeSummary.overview.signalCounts.uiStructureChanged ?? 0) > 0) {
    triggers.push(
      `${changeSummary.overview.signalCounts.uiStructureChanged ?? 0} file change(s) changed persisted UI structure`,
    );
  }

  if ((changeSummary.overview.signalCounts.uiPropsChanged ?? 0) > 0) {
    triggers.push(
      `${changeSummary.overview.signalCounts.uiPropsChanged ?? 0} file change(s) changed persisted UI prop usage`,
    );
  }

  if ((changeSummary.overview.signalCounts.uiRenderingChanged ?? 0) > 0) {
    triggers.push(
      `${changeSummary.overview.signalCounts.uiRenderingChanged ?? 0} file change(s) changed UI rendering semantics`,
    );
  }

  if (filesChanged >= largeScaleThreshold) {
    triggers.push(
      `${filesChanged} file(s) changed in a repository with ${current.counts.files} indexed files, which exceeds the large-scale validation threshold`,
    );
  }

  if (coreSharedFiles.length > 0) {
    triggers.push(
      `${coreSharedFiles.length} changed file(s) were under core/shared/component paths (${sortStrings(coreSharedFiles.map((file) => file.key)).slice(0, 3).join(', ')})`,
    );
  }

  return sortStrings(triggers);
}

function mapCountRegressionIssue(issue: CountRegressionIssue): HighRiskRefreshValidationIssue {
  return createIssue(
    `catastrophic-${issue.metric}-regression`,
    'error',
    issue.summary,
    issue.details,
    issue.recommendedAction,
  );
}

function collectManifestFileIds(current: IndexGenerationState): Set<string> {
  return new Set(current.manifest.map((entry) => `${entry.repoId}:${entry.filePath}`));
}

function collectExplicitCoverageExemptions(current: IndexGenerationState): Set<string> {
  return new Set(
    (current.indexingCoverage?.issues ?? [])
      .filter((issue) => typeof issue.fileId === 'string' && issue.fileId.length > 0)
      .map((issue) => issue.fileId as string),
  );
}

function getUiRelatedChangedFiles(changeSummary: GenerationChangeSummary): RepositoryFileChangeRecord[] {
  return changeSummary.files.filter(
    (file) =>
      file.changeKind !== 'deleted' &&
      (file.signals.includes('uiStructureChanged') ||
        file.signals.includes('uiPropsChanged') ||
        file.impactHints.includes('requiresUiRefresh')),
  );
}

export function evaluateHighRiskRefreshValidation(options: {
  checkedAt: string;
  current: IndexGenerationState;
  changeSummary: GenerationChangeSummary;
  baseline: IndexGenerationState | null;
  symbolIndex: SymbolIndex;
  graph: CodeGraphSnapshot;
  uiComposition: UiCompositionIndex;
  uiProps: UiPropSurfaceIndex;
  patternIndex: PatternIndex;
}): HighRiskRefreshValidationAssessment {
  const { checkedAt, current, changeSummary, baseline, symbolIndex, graph, uiComposition, uiProps, patternIndex } =
    options;
  const triggers = findHighRiskTriggers(changeSummary, current);

  if (triggers.length === 0) {
    return {
      status: 'not-applicable',
      checkedAt,
      isHighRiskRefresh: false,
      triggers: [],
      issues: [],
    };
  }

  const issues: HighRiskRefreshValidationIssue[] = [];
  const manifestFileIds = collectManifestFileIds(current);
  const explicitCoverageExemptions = collectExplicitCoverageExemptions(current);
  const symbolFileIds = new Set(Object.keys(symbolIndex.byFile));
  const missingRelations = current.manifest
    .filter((entry) => !symbolFileIds.has(`${entry.repoId}:${entry.filePath}`))
    .filter((entry) => !explicitCoverageExemptions.has(`${entry.repoId}:${entry.filePath}`))
    .map((entry) => entry.key);
  const allowableMissingRelationCount = current.indexingCoverage?.skippedFiles ?? 0;
  const unresolvedMissingRelations =
    missingRelations.length > allowableMissingRelationCount
      ? missingRelations.slice(0, missingRelations.length - allowableMissingRelationCount)
      : [];

  if (unresolvedMissingRelations.length > 0) {
    issues.push(
      createIssue(
        'missing-symbol-relations',
        'error',
        'high-risk refresh left manifest files without symbol-index relations',
        `${unresolvedMissingRelations.length} manifest file(s) were missing from symbol-index.json beyond the explicit skipped-file allowance after a high-risk refresh (${unresolvedMissingRelations.slice(0, 5).join(', ')})`,
        'rebuild the generation and verify the symbol index completed before publish',
      ),
    );
  }

  const graphFileIds = new Set(Object.keys(graph.nodes.files));
  const missingGraphFiles = Array.from(symbolFileIds).filter((fileId) => !graphFileIds.has(fileId));

  if (missingGraphFiles.length > 0) {
    issues.push(
      createIssue(
        'missing-graph-files',
        'error',
        'high-risk refresh produced a graph missing indexed files',
        `${missingGraphFiles.length} file node(s) were absent from code-graph.json even though symbol-index.json still contained them`,
        'rebuild the graph artifacts from the current symbol index before publish',
      ),
    );
  }

  const validGraphNodeIds = new Set<string>([
    ...Object.keys(graph.nodes.repos),
    ...Object.keys(graph.nodes.files),
    ...Object.keys(graph.nodes.symbols),
  ]);
  const danglingGraphEdges = graph.edges.filter(
    (edge) => !validGraphNodeIds.has(edge.fromId) || !validGraphNodeIds.has(edge.toId),
  );

  if (danglingGraphEdges.length > 0) {
    issues.push(
      createIssue(
        'dangling-graph-edges',
        'error',
        'high-risk refresh produced graph edges that reference missing nodes',
        `${danglingGraphEdges.length} graph edge(s) referenced file or symbol nodes that do not exist in the rebuilt graph`,
        'rebuild the current generation and verify graph derivation completed from the final symbol index',
      ),
    );
  }

  const orphanPatterns = patternIndex.patterns.filter((pattern) => !manifestFileIds.has(pattern.fileId));

  if (orphanPatterns.length > 0) {
    issues.push(
      createIssue(
        'orphan-pattern-entries',
        'error',
        'high-risk refresh produced pattern entries for files outside the current manifest',
        `${orphanPatterns.length} pattern candidate(s) referenced file ids that are not present in the current manifest`,
        'rebuild pattern artifacts from the current manifest and symbol index before publish',
      ),
    );
  }

  const manifestPaths = new Set(current.manifest.map((entry) => entry.filePath));
  const invalidUiEdges = uiComposition.edges.filter(
    (edge) => !manifestPaths.has(edge.parentFilePath) || (edge.childFilePath !== undefined && !manifestPaths.has(edge.childFilePath)),
  );
  const invalidUiProps = uiProps.propUsages.filter(
    (usage) =>
      !manifestPaths.has(usage.parentFilePath) ||
      (usage.childFilePath !== undefined && !manifestPaths.has(usage.childFilePath)),
  );

  if (invalidUiEdges.length > 0 || invalidUiProps.length > 0) {
    issues.push(
      createIssue(
        'invalid-ui-artifacts',
        'error',
        'high-risk refresh produced UI artifacts that reference files outside the current manifest',
        `${invalidUiEdges.length} UI composition edge(s) and ${invalidUiProps.length} UI prop usage(s) referenced files that are not in the current manifest`,
        'rebuild UI artifacts from the current manifest before publish',
      ),
    );
  }

  for (const issue of evaluateCatastrophicCountRegressions({
    current,
    baseline,
    changeSummary,
  })) {
    issues.push(mapCountRegressionIssue(issue));
  }

  const uiRelatedChangedFiles = getUiRelatedChangedFiles(changeSummary);
  const baselineUiSignals = (baseline?.counts.uiCompositionEdges ?? 0) + (baseline?.counts.uiPropUsages ?? 0);
  const currentUiSignals = current.counts.uiCompositionEdges + current.counts.uiPropUsages;

  if (uiRelatedChangedFiles.length > 0 && baselineUiSignals > 0 && currentUiSignals === 0) {
    issues.push(
      createIssue(
        'ui-signals-disappeared',
        'warning',
        'high-risk UI changes were followed by a complete loss of persisted UI signals',
        `${uiRelatedChangedFiles.length} UI-related changed file(s) were followed by zero persisted UI composition/prop entries even though the prior trusted baseline had ${baselineUiSignals}`,
        'inspect UI artifact rebuild output and consider a full refresh if UI hierarchy data should still exist',
      ),
    );
  }

  return {
    status: issues.some((issue) => issue.severity === 'error')
      ? 'failed'
      : issues.length > 0
        ? 'degraded'
        : 'passed',
    checkedAt,
    isHighRiskRefresh: true,
    triggers,
    issues,
  };
}
