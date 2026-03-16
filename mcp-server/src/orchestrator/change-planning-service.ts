import type { SymbolKind } from '../types.js';
import { analyzeSymbolImpact } from './impact-analysis-service.js';
import type {
  ImpactAnalysisResult,
  ImpactConfidence,
  ImpactEvidence,
  ImpactedFile,
  ImpactedSymbol,
  TransitiveImpact,
} from './impact-analysis-types.js';
import { analyzeSymbolOwnership } from './symbol-ownership-service.js';
import type {
  ApiBoundaryClassification,
  OwnershipClassification,
  OwnershipSignal,
  SymbolOwnershipResult,
} from './symbol-ownership-types.js';
import type {
  AnalyzeSymbolChangePlanInput,
  ChangePlanStep,
  ChangePlanningSignal,
  ChangeRiskLevel,
  ChangeScope,
  PlannedFileRole,
  SymbolChangePlanResult,
} from './change-planning-types.js';

type UsageKind =
  | 'local-only'
  | 'feature-local'
  | 'cross-feature'
  | 'repo-wide'
  | 'unknown';

interface FilePlanCandidate {
  filePath: string;
  role: PlannedFileRole;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  bucket: 'primary' | 'secondary' | 'surface' | 'review' | 'test';
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function compareFilePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function getFeatureAreaKey(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 0) {
    return '';
  }

  if (segments[0] === 'src' && segments.length >= 3 && ['features', 'app', 'pages', 'components', 'lib'].includes(segments[1])) {
    return `${segments[0]}/${segments[1]}/${segments[2]}`;
  }

  if (['features', 'app', 'pages', 'components', 'lib'].includes(segments[0]) && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }

  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }

  return segments[0];
}

function isEntrySurfacePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    /(^|\/)(index|mod)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)(page|layout|route)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)(public-api|entry)\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function isTestOrStoryPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    /(^|\/)__tests__\//i.test(normalized) ||
    /(^|\/)(tests?|fixtures?)\//i.test(normalized) ||
    /\.(test|spec|stories|story)\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function confidenceWeight(confidence: ImpactConfidence): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

function planningConfidenceFromImpact(confidence: ImpactConfidence): 'high' | 'medium' | 'low' {
  return confidence;
}

function getUsageKind(signals: OwnershipSignal[]): UsageKind {
  if (signals.some((entry) => entry.type === 'repo-wide-usage')) {
    return 'repo-wide';
  }

  if (signals.some((entry) => entry.type === 'cross-feature-usage')) {
    return 'cross-feature';
  }

  if (signals.some((entry) => entry.type === 'feature-local-usage')) {
    return 'feature-local';
  }

  if (signals.some((entry) => entry.type === 'local-only-usage')) {
    return 'local-only';
  }

  return 'unknown';
}

function toPlanningSignals(ownership: SymbolOwnershipResult, impact: ImpactAnalysisResult): ChangePlanningSignal[] {
  const signals: ChangePlanningSignal[] = [];
  const usageKind = getUsageKind(ownership.signals);
  const directCount = impact.directlyImpactedFiles.length + impact.directlyImpactedSymbols.length;
  const transitiveCount = impact.transitiveImpacts.length;
  const totalBreadth = directCount + transitiveCount;

  signals.push({
    type: 'ownership',
    strength: ownership.ownership === 'unknown' ? 'weak' : ownership.ownership.includes('surface') ? 'strong' : 'moderate',
    note: `ownership classified as ${ownership.ownership}`,
  });
  signals.push({
    type: 'api-boundary',
    strength: ownership.apiBoundary === 'unknown' ? 'weak' : ownership.apiBoundary.includes('shared') || ownership.apiBoundary.includes('public') ? 'strong' : 'moderate',
    note: `API boundary classified as ${ownership.apiBoundary}`,
  });

  if (directCount > 0) {
    signals.push({
      type: 'direct-impact',
      strength: directCount >= 4 ? 'strong' : directCount >= 2 ? 'moderate' : 'weak',
      note: `${directCount} direct impact targets identified`,
    });
  }

  if (transitiveCount > 0) {
    signals.push({
      type: 'transitive-impact',
      strength: transitiveCount >= 5 ? 'strong' : 'moderate',
      note: `${transitiveCount} transitive impact targets identified`,
    });
  }

  if (ownership.signals.some((entry) => entry.type === 'barrel-participation' && entry.strength !== 'weak')) {
    signals.push({
      type: 'barrel-surface',
      strength: ownership.signals.some((entry) => entry.type === 'barrel-participation' && entry.strength === 'strong') ? 'strong' : 'moderate',
      note: 'symbol participates in a barrel or entry-style export surface',
    });
  }

  if (
    ownership.signals.some((entry) => entry.note?.includes('framework entry-surface convention')) ||
    ownership.summary.includes('framework entry surface')
  ) {
    signals.push({
      type: 'framework-entry',
      strength: 'strong',
      note: 'target sits on a framework entry surface',
    });
  }

  if (usageKind === 'local-only') {
    signals.push({
      type: 'local-only',
      strength: 'strong',
      note: 'current ownership evidence stays local to the defining file or directory',
    });
  }

  if (usageKind === 'feature-local') {
    signals.push({
      type: 'feature-bounded',
      strength: 'strong',
      note: 'usage remains bounded to one feature area',
    });
  }

  if (usageKind === 'cross-feature') {
    signals.push({
      type: 'cross-feature',
      strength: 'moderate',
      note: 'usage crosses feature boundaries',
    });
  }

  if (usageKind === 'repo-wide') {
    signals.push({
      type: 'repo-wide',
      strength: 'strong',
      note: 'usage fan-out appears broad across the repository',
    });
  }

  if (totalBreadth >= 8 || impact.summary.directFileCount >= 5) {
    signals.push({
      type: 'high-fanout',
      strength: 'strong',
      note: `impact breadth reaches ${totalBreadth} files or symbols across direct and transitive layers`,
    });
  }

  return signals;
}

function collectImpactedPaths(impact: ImpactAnalysisResult, targetFilePath: string): string[] {
  const filePaths = new Set<string>();

  for (const entry of impact.directlyImpactedFiles) {
    filePaths.add(normalizePath(entry.filePath));
  }

  for (const entry of impact.directlyImpactedSymbols) {
    filePaths.add(normalizePath(entry.filePath));
  }

  for (const entry of impact.transitiveImpacts) {
    if (entry.file?.filePath) {
      filePaths.add(normalizePath(entry.file.filePath));
    }

    if (entry.symbol?.filePath) {
      filePaths.add(normalizePath(entry.symbol.filePath));
    }
  }

  filePaths.delete(normalizePath(targetFilePath));
  return [...filePaths].sort(compareFilePaths);
}

function impactsStayInOneFeature(impact: ImpactAnalysisResult, targetFilePath: string): boolean {
  const impactedPaths = collectImpactedPaths(impact, targetFilePath);

  if (impactedPaths.length === 0) {
    return true;
  }

  const targetFeature = getFeatureAreaKey(targetFilePath);

  if (!targetFeature) {
    return false;
  }

  return impactedPaths.every((filePath) => getFeatureAreaKey(filePath) === targetFeature);
}

function classifyScope(ownership: SymbolOwnershipResult, impact: ImpactAnalysisResult, signals: ChangePlanningSignal[]): ChangeScope {
  const targetFilePath = ownership.target.filePath || impact.target.file?.filePath || '';
  const sameFeatureOnly = targetFilePath ? impactsStayInOneFeature(impact, targetFilePath) : false;
  const highFanout = signals.some((entry) => entry.type === 'high-fanout');
  const repoWide = signals.some((entry) => entry.type === 'repo-wide');
  const barrelSurface = signals.some((entry) => entry.type === 'barrel-surface');

  if (ownership.ownership === 'internal-local' && impact.directlyImpactedFiles.length === 0 && impact.transitiveImpacts.length === 0) {
    return 'local-file';
  }

  if (ownership.ownership === 'internal-local' && signals.some((entry) => entry.type === 'local-only')) {
    return 'local-file';
  }

  if (ownership.ownership === 'feature-internal' && sameFeatureOnly) {
    return 'feature-bounded';
  }

  if (
    ownership.ownership === 'shared-internal' &&
    (repoWide || highFanout || impact.summary.directFileCount >= 5 || impact.summary.transitiveFileCount >= 4)
  ) {
    return 'broad-shared';
  }

  if (
    (ownership.ownership === 'shared-surface' || ownership.ownership === 'public-surface') &&
    (repoWide || highFanout) &&
    impact.summary.directFileCount >= 4
  ) {
    return 'broad-shared';
  }

  if (ownership.ownership === 'shared-surface' || ownership.ownership === 'public-surface') {
    return 'shared-surface';
  }

  if (ownership.ownership === 'shared-internal') {
    return 'shared-internal';
  }

  if (ownership.ownership === 'feature-internal' && signals.some((entry) => entry.type === 'feature-bounded')) {
    return 'feature-bounded';
  }

  if (barrelSurface && !repoWide) {
    return 'shared-surface';
  }

  return 'unknown';
}

function classifyRisk(scope: ChangeScope, ownership: SymbolOwnershipResult, impact: ImpactAnalysisResult, signals: ChangePlanningSignal[]): ChangeRiskLevel {
  const highFanout = signals.some((entry) => entry.type === 'high-fanout');
  const repoWide = signals.some((entry) => entry.type === 'repo-wide');
  const directBreadth = impact.summary.directFileCount + impact.summary.directSymbolCount;

  switch (scope) {
    case 'local-file':
      return 'low';
    case 'feature-bounded':
      return directBreadth >= 4 || impact.summary.transitiveFileCount >= 2 ? 'medium' : 'low';
    case 'shared-internal':
      return highFanout || repoWide ? 'high' : 'medium';
    case 'shared-surface':
      return highFanout || repoWide || directBreadth >= 4 ? 'high' : 'medium';
    case 'broad-shared':
      return 'high';
    case 'unknown':
      return ownership.confidence === 'low' ? 'unknown' : 'medium';
  }
}

function evidenceHasReason(evidence: ImpactEvidence[], reason: string): boolean {
  return evidence.some((entry) => entry.reason === reason);
}

function getRoleBucket(role: PlannedFileRole): FilePlanCandidate['bucket'] {
  switch (role) {
    case 'edit-primary':
      return 'primary';
    case 'edit-secondary':
    case 'dependent-consumer':
      return 'secondary';
    case 'entry-surface':
      return 'surface';
    case 'test-or-story':
      return 'test';
    case 'review-only':
    case 'unknown':
      return 'review';
  }
}

function toCandidateFromDirectFile(
  entry: ImpactedFile,
  scope: ChangeScope,
  targetFilePath: string,
): FilePlanCandidate | null {
  const filePath = normalizePath(entry.filePath);

  if (!filePath || filePath === normalizePath(targetFilePath)) {
    return null;
  }

  if (isTestOrStoryPath(filePath)) {
    return {
      filePath,
      role: 'test-or-story',
      reason: 'test or story file directly imports the target file',
      confidence: planningConfidenceFromImpact(entry.confidence),
      bucket: 'test',
    };
  }

  if (evidenceHasReason(entry.evidence, 'reexports-target') || isEntrySurfacePath(filePath)) {
    return {
      filePath,
      role: 'entry-surface',
      reason: 'entry surface or barrel file should be checked alongside the defining file',
      confidence: planningConfidenceFromImpact(entry.confidence),
      bucket: 'surface',
    };
  }

  return {
    filePath,
    role: scope === 'local-file' ? 'review-only' : 'edit-secondary',
    reason: 'direct importer likely needs an edit or targeted review',
    confidence: planningConfidenceFromImpact(entry.confidence),
    bucket: scope === 'local-file' ? 'review' : 'secondary',
  };
}

function toCandidateFromDirectSymbol(
  entry: ImpactedSymbol,
  scope: ChangeScope,
  targetFilePath: string,
): FilePlanCandidate | null {
  const filePath = normalizePath(entry.filePath);

  if (!filePath || filePath === normalizePath(targetFilePath)) {
    return null;
  }

  if (isTestOrStoryPath(filePath)) {
    return {
      filePath,
      role: 'test-or-story',
      reason: `test or story symbol "${entry.symbolName}" references the target`,
      confidence: planningConfidenceFromImpact(entry.confidence),
      bucket: 'test',
    };
  }

  if (isEntrySurfacePath(filePath) || evidenceHasReason(entry.evidence, 'reexports-target')) {
    return {
      filePath,
      role: 'entry-surface',
      reason: `entry or barrel symbol "${entry.symbolName}" references the target`,
      confidence: planningConfidenceFromImpact(entry.confidence),
      bucket: 'surface',
    };
  }

  return {
    filePath,
    role: scope === 'local-file' ? 'review-only' : 'dependent-consumer',
    reason: `consumer symbol "${entry.symbolName}" should be inspected after the defining file`,
    confidence: planningConfidenceFromImpact(entry.confidence),
    bucket: scope === 'local-file' ? 'review' : 'secondary',
  };
}

function toCandidateFromTransitive(entry: TransitiveImpact, targetFilePath: string): FilePlanCandidate | null {
  const filePath = normalizePath(entry.file?.filePath ?? entry.symbol?.filePath ?? '');

  if (!filePath || filePath === normalizePath(targetFilePath)) {
    return null;
  }

  if (isTestOrStoryPath(filePath)) {
    return {
      filePath,
      role: 'test-or-story',
      reason: 'test or story file appears in the broader transitive impact path',
      confidence: planningConfidenceFromImpact(entry.confidence),
      bucket: 'test',
    };
  }

  return {
    filePath,
    role: isEntrySurfacePath(filePath) ? 'entry-surface' : 'review-only',
    reason: isEntrySurfacePath(filePath)
      ? 'entry surface appears in the transitive impact path and should be reviewed'
      : 'broader dependent file should be reviewed after direct consumers',
    confidence: planningConfidenceFromImpact(entry.confidence),
    bucket: isEntrySurfacePath(filePath) ? 'surface' : 'review',
  };
}

function mergeCandidate(current: FilePlanCandidate | undefined, incoming: FilePlanCandidate): FilePlanCandidate {
  if (!current) {
    return incoming;
  }

  if (current.bucket !== incoming.bucket) {
    const bucketOrder = ['primary', 'secondary', 'surface', 'review', 'test'];
    return bucketOrder.indexOf(incoming.bucket) < bucketOrder.indexOf(current.bucket) ? incoming : current;
  }

  if (current.role !== incoming.role) {
    const preferredRoleOrder: PlannedFileRole[] = [
      'edit-primary',
      'edit-secondary',
      'dependent-consumer',
      'entry-surface',
      'review-only',
      'test-or-story',
      'unknown',
    ];
    return preferredRoleOrder.indexOf(incoming.role) < preferredRoleOrder.indexOf(current.role) ? incoming : current;
  }

  return confidenceWeight(incoming.confidence) > confidenceWeight(current.confidence) ? incoming : current;
}

function toOrderedPlan(targetFilePath: string, impact: ImpactAnalysisResult, scope: ChangeScope): ChangePlanStep[] {
  const candidates = new Map<string, FilePlanCandidate>();
  const normalizedTargetFilePath = normalizePath(targetFilePath);

  candidates.set(normalizedTargetFilePath, {
    filePath: normalizedTargetFilePath,
    role: 'edit-primary',
    reason: 'defining file should be updated first',
    confidence: 'high',
    bucket: 'primary',
  });

  for (const entry of impact.directlyImpactedSymbols) {
    const candidate = toCandidateFromDirectSymbol(entry, scope, normalizedTargetFilePath);

    if (!candidate) {
      continue;
    }

    candidates.set(candidate.filePath, mergeCandidate(candidates.get(candidate.filePath), candidate));
  }

  for (const entry of impact.directlyImpactedFiles) {
    const candidate = toCandidateFromDirectFile(entry, scope, normalizedTargetFilePath);

    if (!candidate) {
      continue;
    }

    candidates.set(candidate.filePath, mergeCandidate(candidates.get(candidate.filePath), candidate));
  }

  for (const entry of impact.transitiveImpacts) {
    const candidate = toCandidateFromTransitive(entry, normalizedTargetFilePath);

    if (!candidate) {
      continue;
    }

    candidates.set(candidate.filePath, mergeCandidate(candidates.get(candidate.filePath), candidate));
  }

  const bucketOrder: FilePlanCandidate['bucket'][] = ['primary', 'secondary', 'surface', 'review', 'test'];
  const orderedCandidates = [...candidates.values()].sort((left, right) => {
    return (
      bucketOrder.indexOf(left.bucket) - bucketOrder.indexOf(right.bucket) ||
      compareFilePaths(left.filePath, right.filePath)
    );
  });

  return orderedCandidates.map((entry, index) => ({
    order: index + 1,
    filePath: entry.filePath,
    role: entry.role,
    reason: entry.reason,
    confidence: entry.confidence,
  }));
}

function classifyLists(plan: ChangePlanStep[]): {
  primaryEditFiles: string[];
  secondaryEditFiles: string[];
  reviewFiles: string[];
} {
  const primaryEditFiles = plan.filter((entry) => entry.role === 'edit-primary').map((entry) => entry.filePath);
  const secondaryEditFiles = plan
    .filter((entry) => {
      if (entry.role === 'edit-secondary' || entry.role === 'dependent-consumer') {
        return true;
      }

      return entry.role === 'entry-surface' && /barrel/i.test(entry.reason);
    })
    .map((entry) => entry.filePath);
  const reviewFiles = plan
    .filter((entry) => entry.role === 'review-only' || entry.role === 'test-or-story' || entry.role === 'entry-surface')
    .map((entry) => entry.filePath);

  return {
    primaryEditFiles,
    secondaryEditFiles,
    reviewFiles,
  };
}

function describeTarget(kind: SymbolKind | undefined, filePath: string, symbolName: string | undefined): string {
  const normalized = normalizePath(filePath);

  if (kind === 'interface' || kind === 'typeAlias') {
    return 'type';
  }

  if (/db|database|session|runtime|config/i.test(symbolName ?? '') || /(^|\/)(infra|infrastructure|platform|core)\//i.test(normalized)) {
    return 'infrastructure utility';
  }

  if (/hook|use[A-Z]/.test(symbolName ?? '')) {
    return 'hook';
  }

  if (/(^|\/)_?components?\//i.test(normalized) && /^[A-Z]/.test(symbolName ?? '')) {
    return 'component';
  }

  if (kind) {
    return kind;
  }

  return 'symbol';
}

function buildSummary(
  scope: ChangeScope,
  risk: ChangeRiskLevel,
  ownership: SymbolOwnershipResult,
  signals: ChangePlanningSignal[],
): string {
  const targetType = describeTarget(ownership.target.kind, ownership.target.filePath, ownership.target.symbolName);
  const barrelSurface = signals.some((entry) => entry.type === 'barrel-surface');
  const frameworkEntry = signals.some((entry) => entry.type === 'framework-entry');
  const repoWide = signals.some((entry) => entry.type === 'repo-wide');

  switch (scope) {
    case 'local-file':
      return `${targetType} change likely limited to the defining file and nearby local symbols`;
    case 'feature-bounded':
      return `${targetType} change appears feature-bounded; inspect direct consumer files in the same feature area first`;
    case 'shared-internal':
      return `${targetType} change likely affects multiple shared consumers without a stable entry surface`;
    case 'shared-surface':
      if (frameworkEntry) {
        return `${targetType} sits on a framework entry surface; defining module and downstream review are recommended`;
      }

      if (barrelSurface) {
        return `${targetType} surfaced through barrel export; direct consumer and entry-surface review recommended`;
      }

      return `${targetType} participates in a shared boundary; direct dependents should be reviewed before broader surfaces`;
    case 'broad-shared':
      return repoWide
        ? `${targetType} has broad shared fan-out; change should be treated as ${risk}-risk and reviewed across multiple feature surfaces`
        : `${targetType} has broad downstream impact; change should be treated as ${risk}-risk and reviewed widely`;
    case 'unknown':
      return `${targetType} has mixed planning signals; start with the defining file and validate direct consumers before broader edits`;
  }
}

function collectNotes(ownership: SymbolOwnershipResult, impact: ImpactAnalysisResult, scope: ChangeScope): string[] {
  const notes: string[] = [];

  if (ownership.confidence === 'low') {
    notes.push('ownership confidence is low; validate direct consumers before broad edits');
  }

  if (impact.summary.ambiguityDetected) {
    notes.push('impact analysis reported ambiguity in the current graph snapshot');
  }

  if (scope === 'unknown') {
    notes.push('change scope remains mixed; keep edits bounded until direct consumers are verified');
  }

  return notes;
}

function buildMissingResult(input: AnalyzeSymbolChangePlanInput): SymbolChangePlanResult {
  return {
    target: {
      filePath: input.filePath ?? '',
      symbolId: input.symbolId,
      symbolName: input.symbolName,
    },
    scope: 'unknown',
    risk: 'unknown',
    summary: 'change plan could not be derived because the target could not be resolved',
    signals: [],
    primaryEditFiles: [],
    secondaryEditFiles: [],
    reviewFiles: [],
    orderedPlan: [],
    notes: ['target could not be resolved from the current symbol or graph snapshot'],
  };
}

export async function planSymbolChange(input: AnalyzeSymbolChangePlanInput): Promise<SymbolChangePlanResult> {
  const [impact, ownership] = await Promise.all([
    analyzeSymbolImpact({
      repoId: input.repoId,
      symbolId: input.symbolId,
      filePath: input.filePath,
      symbolName: input.symbolName,
      mode: input.impactMode ?? 'exploratory',
      maxDepth: input.maxDepth,
      includeTransitive: true,
    }),
    analyzeSymbolOwnership({
      repoId: input.repoId,
      symbolId: input.symbolId,
      filePath: input.filePath,
      symbolName: input.symbolName,
    }),
  ]);

  const filePath = ownership.target.filePath || impact.target.file?.filePath || input.filePath || '';

  if (!filePath) {
    return buildMissingResult(input);
  }

  const signals = toPlanningSignals(ownership, impact);
  const scope = classifyScope(ownership, impact, signals);
  const risk = classifyRisk(scope, ownership, impact, signals);
  const orderedPlan = toOrderedPlan(filePath, impact, scope);
  const fileLists = classifyLists(orderedPlan);
  const notes = collectNotes(ownership, impact, scope);

  return {
    target: {
      filePath,
      symbolId: ownership.target.symbolId ?? impact.target.symbolId ?? input.symbolId,
      symbolName: ownership.target.symbolName ?? impact.target.symbolName ?? input.symbolName,
      kind: ownership.target.kind ?? impact.target.kind ?? undefined,
    },
    scope,
    risk,
    summary: buildSummary(scope, risk, ownership, signals),
    signals,
    primaryEditFiles: fileLists.primaryEditFiles,
    secondaryEditFiles: fileLists.secondaryEditFiles,
    reviewFiles: fileLists.reviewFiles,
    orderedPlan,
    notes: notes.length > 0 ? notes : undefined,
  };
}
