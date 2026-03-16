import path from 'node:path';

import { getFileNode, getImportingFiles, getReexportingFiles } from '../graph/query.js';
import type { FileNode } from '../graph/types.js';
import { getFileRelation, getFileRelationById } from '../symbol-index/query.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import type {
  AnalyzeSymbolOwnershipInput,
  ApiBoundaryClassification,
  OwnershipClassification,
  OwnershipConfidence,
  OwnershipSignal,
  SymbolOwnershipResult,
  SymbolOwnershipTarget,
} from './symbol-ownership-types.js';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function compareFiles(left: { repoId?: string; filePath: string }, right: { repoId?: string; filePath: string }): number {
  return (left.repoId ?? '').localeCompare(right.repoId ?? '') || left.filePath.localeCompare(right.filePath);
}

function isEntryLikeFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    /(^|\/)(index|mod)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)(page|layout|route)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)(public-api|entry)\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function isBarrelFile(filePath: string): boolean {
  return /(^|\/)(index|mod)\.(tsx?|jsx?)$/i.test(normalizePath(filePath));
}

function stripExtension(filePath: string): string {
  return normalizePath(filePath).replace(/\.(tsx?|jsx?)$/i, '');
}

function isLikelyReexportFromTarget(entry: { source?: string }, targetFilePath: string): boolean {
  if (!entry.source) {
    return false;
  }

  const source = stripExtension(entry.source).replace(/\/index$/i, '');
  const target = stripExtension(targetFilePath).replace(/\/index$/i, '');
  const sourceBase = path.posix.basename(source);
  const targetBase = path.posix.basename(target);

  return source === target || target.endsWith(`/${source}`) || source.endsWith(`/${targetBase}`) || sourceBase === targetBase;
}

function getPathSignals(filePath: string): {
  signals: OwnershipSignal[];
  boundaryKind: 'internal' | 'feature' | 'shared' | 'public' | 'infrastructure' | 'unknown';
  pathHasInternalMarkers: boolean;
} {
  const normalized = normalizePath(filePath);
  const internalPattern = /(^|\/)(internal|private|impl|implementation|helpers?|__tests__|tests?|fixtures?)\//i;
  const publicPattern = /(^|\/)(public|api|exports?)\//i;
  const featurePattern = /^(src\/)?(features?|app|pages)\//i;
  const infraPattern = /(^|\/)(infra|infrastructure|platform|core)\//i;

  if (internalPattern.test(normalized)) {
    return {
      signals: [{
        type: 'path-boundary',
        strength: 'strong',
        note: `path "${normalized}" includes internal or helper-style segments`,
      }],
      boundaryKind: 'internal',
      pathHasInternalMarkers: true,
    };
  }

  if (publicPattern.test(normalized) || /^src\/index\.(tsx?|jsx?)$/i.test(normalized) || /^index\.(tsx?|jsx?)$/i.test(normalized)) {
    return {
      signals: [{
        type: 'path-boundary',
        strength: 'strong',
        note: `path "${normalized}" matches a public or entry-surface convention`,
      }],
      boundaryKind: 'public',
      pathHasInternalMarkers: false,
    };
  }

  if (
    /^(src\/)?(shared|common)\//i.test(normalized) ||
    /^(src\/)?components\/(ui|shared)\//i.test(normalized) ||
    /(^|\/)(shared|common)\//i.test(normalized)
  ) {
    return {
      signals: [{
        type: 'path-boundary',
        strength: 'moderate',
        note: `path "${normalized}" sits in a shared or reusable area`,
      }],
      boundaryKind: 'shared',
      pathHasInternalMarkers: false,
    };
  }

  if (featurePattern.test(normalized)) {
    return {
      signals: [{
        type: 'path-boundary',
        strength: 'moderate',
        note: `path "${normalized}" sits inside a feature-oriented area`,
      }],
      boundaryKind: 'feature',
      pathHasInternalMarkers: false,
    };
  }

  if (infraPattern.test(normalized)) {
    return {
      signals: [{
        type: 'path-boundary',
        strength: 'moderate',
        note: `path "${normalized}" sits in infrastructure-style code`,
      }],
      boundaryKind: 'infrastructure',
      pathHasInternalMarkers: false,
    };
  }

  return {
    signals: [{
      type: 'path-boundary',
      strength: 'weak',
      note: `path "${normalized}" does not strongly indicate a public, shared, or internal boundary`,
    }],
    boundaryKind: 'unknown',
    pathHasInternalMarkers: false,
  };
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

function getDirectoryKey(filePath: string): string {
  const normalized = normalizePath(filePath);
  const directory = path.posix.dirname(normalized);
  return directory === '.' ? normalized : directory;
}

function getUsageSignals(targetFilePath: string, importers: FileNode[]): {
  signals: OwnershipSignal[];
  usageKind: 'none' | 'local-only' | 'feature-local' | 'cross-feature' | 'repo-wide';
  importerCount: number;
  distinctFeatureAreas: number;
} {
  if (importers.length === 0) {
    return {
      signals: [
        {
          type: 'usage-fanout',
          strength: 'weak',
          note: 'no direct importer files were found in the current graph snapshot',
        },
        {
          type: 'local-only-usage',
          strength: 'strong',
          note: 'current evidence stays within the defining file or local implementation context',
        },
      ],
      usageKind: 'none',
      importerCount: 0,
      distinctFeatureAreas: 0,
    };
  }

  const targetDirectory = getDirectoryKey(targetFilePath);
  const targetFeature = getFeatureAreaKey(targetFilePath);
  const importerDirectories = new Set(importers.map((entry) => getDirectoryKey(entry.filePath)));
  const importerFeatures = new Set(importers.map((entry) => getFeatureAreaKey(entry.filePath)).filter(Boolean));

  if (importerDirectories.size === 1 && importerDirectories.has(targetDirectory)) {
    return {
      signals: [
        {
          type: 'usage-fanout',
          strength: 'weak',
          note: 'direct importer fan-out stays inside the defining directory',
        },
        {
          type: 'local-only-usage',
          strength: 'strong',
          note: 'all observed importers remain in the same local directory',
        },
      ],
      usageKind: 'local-only',
      importerCount: importers.length,
      distinctFeatureAreas: importerFeatures.size,
    };
  }

  if (importerFeatures.size <= 1 && targetFeature && importerFeatures.has(targetFeature)) {
    return {
      signals: [
        {
          type: 'usage-fanout',
          strength: 'moderate',
          note: `direct importer fan-out stays within the feature area "${targetFeature}"`,
        },
        {
          type: 'feature-local-usage',
          strength: 'strong',
          note: 'usage appears bounded to one feature area',
        },
      ],
      usageKind: 'feature-local',
      importerCount: importers.length,
      distinctFeatureAreas: importerFeatures.size,
    };
  }

  if (importerFeatures.size >= 4 || importers.length >= 6) {
    return {
      signals: [
        {
          type: 'usage-fanout',
          strength: 'strong',
          note: `${importers.length} importer files span ${importerFeatures.size} feature areas`,
        },
        {
          type: 'repo-wide-usage',
          strength: 'strong',
          note: 'usage fan-out appears broad across the repository',
        },
      ],
      usageKind: 'repo-wide',
      importerCount: importers.length,
      distinctFeatureAreas: importerFeatures.size,
    };
  }

  return {
    signals: [
      {
        type: 'usage-fanout',
        strength: 'moderate',
        note: `${importers.length} importer files span ${Math.max(importerFeatures.size, 1)} feature areas`,
      },
      {
        type: 'cross-feature-usage',
        strength: 'moderate',
        note: 'usage crosses feature boundaries without clearly reaching repo-wide fan-out',
      },
    ],
    usageKind: 'cross-feature',
    importerCount: importers.length,
    distinctFeatureAreas: importerFeatures.size,
  };
}

function getExportSurfaceSignals(symbol: IndexedSymbol | null, relation: FileRelation | null, filePath: string): {
  signals: OwnershipSignal[];
  exportedFromFile: boolean;
  entrySurfaceExport: boolean;
} {
  const hasExports = (relation?.exports.length ?? 0) > 0;
  const exportedFromFile = symbol
    ? relation?.exports.some((entry) => entry.symbolId === symbol.symbolId || entry.localName === symbol.name) ?? Boolean(symbol.exported)
    : hasExports;
  const entrySurfaceExport = exportedFromFile && isEntryLikeFile(filePath);

  if (!exportedFromFile) {
    return {
      signals: [{
        type: 'export-surface',
        strength: 'weak',
        note: 'target is not exported from its defining file',
      }],
      exportedFromFile,
      entrySurfaceExport,
    };
  }

  if (entrySurfaceExport) {
    return {
      signals: [{
        type: 'export-surface',
        strength: 'strong',
        note: 'target is exported from an entry-like defining file',
      }],
      exportedFromFile,
      entrySurfaceExport,
    };
  }

  return {
    signals: [{
      type: 'export-surface',
      strength: 'moderate',
      note: 'target is exported from its defining file',
    }],
    exportedFromFile,
    entrySurfaceExport,
  };
}

async function getBarrelSignals(
  symbol: IndexedSymbol | null,
  file: FileNode | null,
  relation: FileRelation | null,
): Promise<{
  signals: OwnershipSignal[];
  reexportedThroughBarrel: boolean;
  participatesInEntrySurface: boolean;
}> {
  if (!file) {
    return {
      signals: [{
        type: 'barrel-participation',
        strength: 'weak',
        note: 'defining file could not be resolved for barrel analysis',
      }],
      reexportedThroughBarrel: false,
      participatesInEntrySurface: false,
    };
  }

  const reexportingFiles = await getReexportingFiles(file.fileId);
  let reexportedThroughBarrel = false;
  let participatesInEntrySurface = isEntryLikeFile(file.filePath) && (relation?.exports.length ?? 0) > 0;

  for (const reexportingFile of reexportingFiles) {
    const reexportRelation = await getFileRelationById(reexportingFile.fileId);

    if (!reexportRelation) {
      continue;
    }

    const matchingExport = reexportRelation.exports.some((entry) => {
      if (!isLikelyReexportFromTarget(entry, file.filePath)) {
        return false;
      }

      if (!symbol) {
        return true;
      }

      return entry.localName === symbol.name || entry.exportedName === symbol.name || entry.symbolId === symbol.symbolId;
    });

    if (!matchingExport) {
      continue;
    }

    participatesInEntrySurface ||= isEntryLikeFile(reexportingFile.filePath);

    if (isBarrelFile(reexportingFile.filePath)) {
      reexportedThroughBarrel = true;
    }
  }

  if (reexportedThroughBarrel) {
    return {
      signals: [{
        type: 'barrel-participation',
        strength: 'strong',
        note: 'target participates in a barrel-style re-export surface',
      }],
      reexportedThroughBarrel,
      participatesInEntrySurface,
    };
  }

  if (participatesInEntrySurface) {
    return {
      signals: [{
        type: 'barrel-participation',
        strength: 'moderate',
        note: 'target participates in an entry-like file surface',
      }],
      reexportedThroughBarrel,
      participatesInEntrySurface,
    };
  }

  return {
    signals: [{
      type: 'barrel-participation',
      strength: 'weak',
      note: 'no barrel or stable entry-surface participation was observed',
    }],
    reexportedThroughBarrel,
    participatesInEntrySurface,
  };
}

async function resolveTarget(input: AnalyzeSymbolOwnershipInput): Promise<SymbolOwnershipTarget> {
  const index = await loadRequiredSymbolIndex();
  let symbol: IndexedSymbol | null = null;
  let relation: FileRelation | null = null;
  let file: FileNode | null = null;

  if (input.symbolId) {
    symbol = index.symbols.find((entry) => entry.symbolId === input.symbolId) ?? null;
  } else if (input.filePath && input.symbolName) {
    const normalizedPath = normalizePath(input.filePath);
    symbol =
      index.symbols.find((entry) => {
        if (input.repoId && entry.repo !== input.repoId) {
          return false;
        }

        return normalizePath(entry.filePath) === normalizedPath && entry.name === input.symbolName;
      }) ?? null;
  }

  if (symbol) {
    relation = await getFileRelationById(symbol.fileId);
    file = await getFileNode(symbol.fileId);
  } else if (input.filePath) {
    try {
      relation = await getFileRelation(input.filePath, input.repoId);
      file = await getFileNode(relation.fileId);
    } catch {
      relation = null;
      file = null;
    }
  }

  return {
    requestedRepoId: input.repoId,
    requestedSymbolId: input.symbolId,
    requestedFilePath: input.filePath,
    requestedSymbolName: input.symbolName,
    symbol,
    file,
    relation,
  };
}

function signalStrengthWeight(strength: OwnershipSignal['strength']): number {
  switch (strength) {
    case 'strong':
      return 3;
    case 'moderate':
      return 2;
    case 'weak':
      return 1;
  }
}

function hasSignal(signals: OwnershipSignal[], type: OwnershipSignal['type'], strength?: OwnershipSignal['strength']): boolean {
  return signals.some((entry) => entry.type === type && (!strength || entry.strength === strength));
}

function classifyOwnership(
  signals: OwnershipSignal[],
  facts: {
    exportedFromFile: boolean;
    reexportedThroughBarrel: boolean;
    participatesInEntrySurface: boolean;
    pathBoundary: 'internal' | 'feature' | 'shared' | 'public' | 'infrastructure' | 'unknown';
    pathHasInternalMarkers: boolean;
    usageKind: 'none' | 'local-only' | 'feature-local' | 'cross-feature' | 'repo-wide';
  },
): OwnershipClassification {
  if (
    facts.exportedFromFile &&
    facts.participatesInEntrySurface &&
    (facts.reexportedThroughBarrel || facts.pathBoundary === 'public') &&
    facts.usageKind === 'repo-wide' &&
    !facts.pathHasInternalMarkers
  ) {
    return 'public-surface';
  }

  if (
    facts.exportedFromFile &&
    (facts.reexportedThroughBarrel || facts.participatesInEntrySurface) &&
    (facts.pathBoundary === 'shared' || facts.pathBoundary === 'public' || facts.usageKind === 'cross-feature' || facts.usageKind === 'repo-wide') &&
    !facts.pathHasInternalMarkers
  ) {
    return 'shared-surface';
  }

  if (
    (facts.pathBoundary === 'shared' || facts.pathBoundary === 'infrastructure' || facts.usageKind === 'cross-feature' || facts.usageKind === 'repo-wide') &&
    !facts.reexportedThroughBarrel &&
    !facts.participatesInEntrySurface
  ) {
    return 'shared-internal';
  }

  if (
    facts.usageKind === 'feature-local' &&
    (facts.pathBoundary === 'feature' || facts.pathBoundary === 'internal' || !facts.exportedFromFile) &&
    !facts.reexportedThroughBarrel
  ) {
    return 'feature-internal';
  }

  if (
    (!facts.exportedFromFile && (facts.usageKind === 'none' || facts.usageKind === 'local-only')) ||
    (facts.pathHasInternalMarkers && facts.usageKind !== 'cross-feature' && facts.usageKind !== 'repo-wide')
  ) {
    return 'internal-local';
  }

  if (
    facts.exportedFromFile &&
    facts.pathHasInternalMarkers &&
    (facts.reexportedThroughBarrel || facts.usageKind === 'repo-wide')
  ) {
    return 'unknown';
  }

  if (!facts.exportedFromFile && facts.usageKind === 'cross-feature' && facts.pathBoundary === 'unknown') {
    return 'unknown';
  }

  return 'unknown';
}

function classifyApiBoundary(
  ownership: OwnershipClassification,
  facts: {
    exportedFromFile: boolean;
    participatesInEntrySurface: boolean;
    pathBoundary: 'internal' | 'feature' | 'shared' | 'public' | 'infrastructure' | 'unknown';
    usageKind: 'none' | 'local-only' | 'feature-local' | 'cross-feature' | 'repo-wide';
  },
): ApiBoundaryClassification {
  if (ownership === 'unknown') {
    return 'unknown';
  }

  if (ownership === 'public-surface') {
    return 'public-boundary';
  }

  if (ownership === 'shared-surface' || (facts.participatesInEntrySurface && (facts.pathBoundary === 'shared' || facts.pathBoundary === 'public'))) {
    return 'shared-boundary';
  }

  if (
    ownership === 'shared-internal' &&
    (facts.pathBoundary === 'shared' ||
      facts.pathBoundary === 'infrastructure' ||
      facts.usageKind === 'cross-feature' ||
      facts.usageKind === 'repo-wide')
  ) {
    return 'shared-boundary';
  }

  if (
    ownership === 'feature-internal' &&
    (facts.participatesInEntrySurface || facts.pathBoundary === 'feature' || facts.usageKind === 'feature-local')
  ) {
    return 'feature-boundary';
  }

  if (facts.exportedFromFile || facts.usageKind === 'local-only') {
    return 'local-boundary';
  }

  if (ownership === 'internal-local') {
    return 'not-api-like';
  }

  return 'unknown';
}

function classifyConfidence(ownership: OwnershipClassification, signals: OwnershipSignal[]): OwnershipConfidence {
  if (ownership === 'unknown') {
    return 'low';
  }

  const strongCount = signals.filter((entry) => entry.strength === 'strong').length;
  const moderateCount = signals.filter((entry) => entry.strength === 'moderate').length;
  const weakCount = signals.filter((entry) => entry.strength === 'weak').length;
  const surfaceSignals = hasSignal(signals, 'export-surface') || hasSignal(signals, 'barrel-participation');
  const internalSignals = hasSignal(signals, 'local-only-usage', 'strong') || signals.some((entry) => entry.note?.includes('internal'));

  if (
    ownership === 'shared-surface' &&
    hasSignal(signals, 'barrel-participation', 'strong') &&
    (hasSignal(signals, 'cross-feature-usage') || hasSignal(signals, 'repo-wide-usage'))
  ) {
    return 'high';
  }

  if (strongCount >= 2 && !(surfaceSignals && internalSignals && ownership !== 'internal-local')) {
    return 'high';
  }

  if (strongCount >= 1 || moderateCount >= 3 || (moderateCount >= 2 && weakCount >= 1)) {
    return 'medium';
  }

  return 'low';
}

function describeTarget(symbol: IndexedSymbol | null, filePath: string): string {
  const normalized = normalizePath(filePath);

  if (symbol?.kind === 'interface' || symbol?.kind === 'typeAlias') {
    return 'type';
  }

  if (/provider/i.test(normalized) || /provider/i.test(symbol?.name ?? '')) {
    return 'provider helper';
  }

  if (/(^|\/)(components?|ui)\//i.test(normalized)) {
    return 'component';
  }

  if (/(^|\/)(utils?|helpers?|lib)\//i.test(normalized)) {
    return 'utility';
  }

  if (/(^|\/)(infra|infrastructure|platform|core)\//i.test(normalized)) {
    return 'infrastructure utility';
  }

  if (symbol?.kind) {
    return symbol.kind;
  }

  return 'module';
}

function getTopSignalNotes(signals: OwnershipSignal[]): string[] {
  return [...signals]
    .sort((left, right) => signalStrengthWeight(right.strength) - signalStrengthWeight(left.strength))
    .map((entry) => entry.note)
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 2);
}

function buildSummary(
  symbol: IndexedSymbol | null,
  filePath: string,
  ownership: OwnershipClassification,
  facts: {
    reexportedThroughBarrel: boolean;
    participatesInEntrySurface: boolean;
    usageKind: 'none' | 'local-only' | 'feature-local' | 'cross-feature' | 'repo-wide';
  },
  signals: OwnershipSignal[],
): string {
  const role = describeTarget(symbol, filePath);

  switch (ownership) {
    case 'internal-local':
      return `${role} with no shared surface signals`;
    case 'feature-internal':
      return `${role} used within one feature area`;
    case 'shared-internal':
      return facts.usageKind === 'repo-wide'
        ? `${role} with broad importer fan-out but no stable entry-surface signal`
        : `${role} reused across feature areas without stable entry-surface exposure`;
    case 'shared-surface':
      return facts.reexportedThroughBarrel
        ? `${role} exposed through barrel export and used across multiple feature areas`
        : `${role} exposed on a shared entry surface with cross-feature usage`;
    case 'public-surface':
      return `${role} exposed on a stable entry surface with broad repo usage`;
    case 'unknown': {
      const notes = getTopSignalNotes(signals);
      return notes.length > 0 ? `${role} has mixed ownership signals: ${notes.join('; ')}` : `${role} has mixed ownership signals`;
    }
  }
}

export async function analyzeSymbolOwnership(input: AnalyzeSymbolOwnershipInput): Promise<SymbolOwnershipResult> {
  const target = await resolveTarget(input);
  const filePath = target.symbol?.filePath ?? target.file?.filePath ?? target.relation?.filePath ?? input.filePath ?? '';

  if (!filePath) {
    return {
      target: {
        filePath: input.filePath ?? '',
        symbolId: input.symbolId,
        symbolName: input.symbolName,
      },
      ownership: 'unknown',
      apiBoundary: 'unknown',
      confidence: 'low',
      signals: [],
      summary: 'ownership could not be derived because the target could not be resolved',
    };
  }

  const fileId = target.symbol?.fileId ?? target.file?.fileId ?? target.relation?.fileId;
  const importers = fileId ? await getImportingFiles(fileId) : [];
  importers.sort(compareFiles);

  const exportSurface = getExportSurfaceSignals(target.symbol, target.relation, filePath);
  const pathBoundary = getPathSignals(filePath);
  const usage = getUsageSignals(filePath, importers);
  const barrel = await getBarrelSignals(target.symbol, target.file, target.relation);
  const signals = [
    ...exportSurface.signals,
    ...pathBoundary.signals,
    ...usage.signals,
    ...barrel.signals,
  ];
  const ownership = classifyOwnership(signals, {
    exportedFromFile: exportSurface.exportedFromFile,
    reexportedThroughBarrel: barrel.reexportedThroughBarrel,
    participatesInEntrySurface: barrel.participatesInEntrySurface || exportSurface.entrySurfaceExport,
    pathBoundary: pathBoundary.boundaryKind,
    pathHasInternalMarkers: pathBoundary.pathHasInternalMarkers,
    usageKind: usage.usageKind,
  });
  const apiBoundary = classifyApiBoundary(ownership, {
    exportedFromFile: exportSurface.exportedFromFile,
    participatesInEntrySurface: barrel.participatesInEntrySurface || exportSurface.entrySurfaceExport,
    pathBoundary: pathBoundary.boundaryKind,
    usageKind: usage.usageKind,
  });
  const confidence = classifyConfidence(ownership, signals);

  return {
    target: {
      filePath,
      symbolId: target.symbol?.symbolId,
      symbolName: target.symbol?.name ?? input.symbolName,
      kind: target.symbol?.kind,
    },
    ownership,
    apiBoundary,
    confidence,
    signals,
    summary: buildSummary(target.symbol, filePath, ownership, {
      reexportedThroughBarrel: barrel.reexportedThroughBarrel,
      participatesInEntrySurface: barrel.participatesInEntrySurface || exportSurface.entrySurfaceExport,
      usageKind: usage.usageKind,
    }, signals),
  };
}
