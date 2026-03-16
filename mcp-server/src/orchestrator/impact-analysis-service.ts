import {
  getDefinedSymbols,
  getFileNode,
  getImportingFiles,
  getReexportingFiles,
} from '../graph/query.js';
import { readRepositoryFile } from '../files.js';
import { getRepositoryById } from '../repositories.js';
import { getFileRelation, getFileRelationById } from '../symbol-index/query.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { ExportRecord, ImportBinding, IndexedSymbol } from '../symbol-index/types.js';
import { loadConfig } from '../config.js';
import type {
  AnalyzeSymbolImpactInput,
  ImpactAnalysisResult,
  ImpactAnalysisSummary,
  ImpactAnalysisTarget,
  ImpactConfidence,
  ImpactEvidence,
  ImpactScope,
  ImpactReason,
  ImpactedFile,
  ImpactedSymbol,
  TransitiveImpact,
} from './impact-analysis-types.js';

const DEFAULT_MAX_DEPTH = 1;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(tsx?|jsx?)$/i, '');
}

function compareFiles(left: { repoId?: string; filePath: string }, right: { repoId?: string; filePath: string }): number {
  return (left.repoId ?? '').localeCompare(right.repoId ?? '') || left.filePath.localeCompare(right.filePath);
}

function compareSymbols(
  left: { repoId?: string; filePath: string; symbolName: string },
  right: { repoId?: string; filePath: string; symbolName: string },
): number {
  return compareFiles(left, right) || left.symbolName.localeCompare(right.symbolName);
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

function reasonWeight(reason: ImpactReason): number {
  switch (reason) {
    case 'imports-target':
      return 6;
    case 'reexports-target':
      return 5;
    case 'exports-target':
      return 4;
    case 'same-file-reference':
      return 3;
    case 'calls-target':
    case 'jsx-uses-target':
    case 'constructs-target':
    case 'extends-target':
    case 'implements-target':
    case 'type-propagation':
      return 2;
    case 'textual-match':
      return 1;
  }
}

function scopeWeight(scope: ImpactScope): number {
  switch (scope) {
    case 'symbol-direct':
      return 5;
    case 'file-direct':
      return 4;
    case 'proxy':
      return 3;
    case 'local-symbol':
      return 2;
    case 'fallback':
      return 1;
  }
}

function pickConfidence(evidence: ImpactEvidence[]): ImpactConfidence {
  let current: ImpactConfidence = 'low';

  for (const entry of evidence) {
    if (confidenceWeight(entry.confidence) > confidenceWeight(current)) {
      current = entry.confidence;
    }
  }

  return current;
}

function compareEvidence(left: ImpactEvidence[], right: ImpactEvidence[]): number {
  const leftTop = [...left].sort((a, b) => {
    return (
      confidenceWeight(b.confidence) - confidenceWeight(a.confidence) ||
      scopeWeight(b.impactScope) - scopeWeight(a.impactScope) ||
      reasonWeight(b.reason) - reasonWeight(a.reason)
    );
  })[0];
  const rightTop = [...right].sort((a, b) => {
    return (
      confidenceWeight(b.confidence) - confidenceWeight(a.confidence) ||
      scopeWeight(b.impactScope) - scopeWeight(a.impactScope) ||
      reasonWeight(b.reason) - reasonWeight(a.reason)
    );
  })[0];

  if (!leftTop && !rightTop) {
    return 0;
  }

  if (!leftTop) {
    return 1;
  }

  if (!rightTop) {
    return -1;
  }

  return (
    confidenceWeight(rightTop.confidence) - confidenceWeight(leftTop.confidence) ||
    scopeWeight(rightTop.impactScope) - scopeWeight(leftTop.impactScope) ||
    reasonWeight(rightTop.reason) - reasonWeight(leftTop.reason)
  );
}

function buildMissingResult(input: AnalyzeSymbolImpactInput, notes: string[]): ImpactAnalysisResult {
  return {
    mode: input.mode,
    target: {
      requestedRepoId: input.repoId,
      requestedSymbolId: input.symbolId,
      requestedFilePath: input.filePath,
      requestedSymbolName: input.symbolName,
      symbol: null,
      symbolId: null,
      symbolName: null,
      kind: null,
      repoId: input.repoId ?? null,
      file: null,
    },
    directlyImpactedSymbols: [],
    directlyImpactedFiles: [],
    transitiveImpacts: [],
    publicSurfaceRisk: {
      level: 'unknown',
      notes: ['public surface risk is not derived in phase 5.1 step B'],
    },
    summary: {
      directFileCount: 0,
      directSymbolCount: 0,
      transitiveFileCount: 0,
      transitiveSymbolCount: 0,
      highConfidenceImpactCount: 0,
      mediumConfidenceImpactCount: 0,
      lowConfidenceImpactCount: 0,
      symbolDirectImpactCount: 0,
      fileDirectImpactCount: 0,
      proxyImpactCount: 0,
      localSymbolImpactCount: 0,
      overview: 'no likely impacts identified because the target could not be resolved',
      ambiguityDetected: false,
      notes,
    },
  };
}

async function resolveTarget(input: AnalyzeSymbolImpactInput): Promise<ImpactAnalysisTarget> {
  const index = await loadRequiredSymbolIndex();
  let symbol: IndexedSymbol | null = null;

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
  } else if (input.filePath) {
    try {
      const relation = await getFileRelation(input.filePath, input.repoId);
      const fileSymbols = index.symbols.filter((entry) => entry.fileId === relation.fileId);

      if (fileSymbols.length === 1) {
        symbol = fileSymbols[0];
      }
    } catch {
      symbol = null;
    }
  }

  if (!symbol) {
    return {
      requestedRepoId: input.repoId,
      requestedSymbolId: input.symbolId,
      requestedFilePath: input.filePath,
      requestedSymbolName: input.symbolName,
      symbol: null,
      symbolId: null,
      symbolName: input.symbolName ?? null,
      kind: null,
      repoId: input.repoId ?? null,
      file: null,
    };
  }

  const file = await getFileNode(symbol.fileId);

  return {
    requestedRepoId: input.repoId,
    requestedSymbolId: input.symbolId,
    requestedFilePath: input.filePath,
    requestedSymbolName: input.symbolName,
    symbol,
    symbolId: symbol.symbolId,
    symbolName: symbol.name,
    kind: symbol.kind,
    repoId: symbol.repo,
    file,
  };
}

async function getFileContent(repoId: string, filePath: string): Promise<string | null> {
  const config = loadConfig();
  const repository = await getRepositoryById(config.reposRoot, repoId);

  if (!repository) {
    return null;
  }

  try {
    const file = await readRepositoryFile(repository, filePath);
    return file.content;
  } catch {
    return null;
  }
}

function lineSlice(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r?\n/);
  return lines.slice(startLine - 1, endLine).join('\n');
}

function containsIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(source);
}

function importSourceLikelyTargetsFile(source: string, targetFilePath: string): boolean {
  const normalizedSource = stripKnownExtension(normalizePath(source)).replace(/\/index$/i, '');
  const normalizedTarget = stripKnownExtension(normalizePath(targetFilePath)).replace(/\/index$/i, '');

  if (!normalizedSource || !normalizedTarget) {
    return false;
  }

  const sourceBase = normalizedSource.split('/').pop() ?? normalizedSource;
  const targetBase = normalizedTarget.split('/').pop() ?? normalizedTarget;

  return (
    normalizedSource === normalizedTarget ||
    normalizedTarget.endsWith(`/${normalizedSource}`) ||
    normalizedSource.endsWith(`/${targetBase}`) ||
    sourceBase === targetBase
  );
}

function buildEvidence(
  reason: ImpactReason,
  confidence: ImpactConfidence,
  filePath: string,
  notes: string[],
  impactScope: ImpactScope,
  source: ImpactEvidence['source'] = 'graph',
  symbolId?: string,
  symbolName?: string,
): ImpactEvidence {
  return {
    reason,
    confidence,
    source,
    impactScope,
    depth: 1,
    via: [
      {
        filePath,
        symbolId,
        symbolName,
        reason,
      },
    ],
    notes,
  };
}

function getTargetExportNames(target: IndexedSymbol, exports: ExportRecord[]): { names: Set<string>; hasDefault: boolean } {
  const names = new Set<string>();
  let hasDefault = false;

  for (const entry of exports) {
    if (entry.symbolId && entry.symbolId !== target.symbolId) {
      continue;
    }

    if (entry.kind === 'default') {
      hasDefault = true;
      if (entry.exportedName) {
        names.add(entry.exportedName);
      }
      continue;
    }

    if (entry.exportedName) {
      names.add(entry.exportedName);
    }

    if (entry.localName === target.name) {
      names.add(entry.exportedName ?? target.name);
    }
  }

  if (target.exported) {
    names.add(target.name);
  }

  return { names, hasDefault };
}

function bindingTargetsSymbol(
  binding: ImportBinding,
  exportedNames: Set<string>,
  hasDefault: boolean,
): boolean {
  if (binding.kind === 'default') {
    return hasDefault;
  }

  if (binding.importedName === null) {
    return false;
  }

  return exportedNames.has(binding.importedName);
}

async function collectSameFileImpacts(target: IndexedSymbol): Promise<ImpactedSymbol[]> {
  const [definedSymbols, content, file] = await Promise.all([
    getDefinedSymbols(target.fileId),
    getFileContent(target.repo, target.filePath),
    getFileNode(target.fileId),
  ]);

  if (!content || !file) {
    return [];
  }

  const impacts: ImpactedSymbol[] = [];

  for (const candidate of definedSymbols) {
    if (candidate.symbolId === target.symbolId) {
      continue;
    }

    const slice = lineSlice(content, candidate.startLine, candidate.endLine);

    if (!containsIdentifier(slice, target.name)) {
      continue;
    }

    const evidence = buildEvidence(
      'same-file-reference',
      'low',
      candidate.filePath,
      ['exact symbol-name occurrence found inside a sibling symbol span in the same file; this is local same-file evidence, not a confirmed symbol reference edge'],
      'local-symbol',
      'symbol-index',
      candidate.symbolId,
      candidate.name,
    );

    impacts.push({
      symbol: candidate,
      file,
      symbolId: candidate.symbolId,
      symbolName: candidate.name,
      kind: candidate.kind,
      exported: candidate.exported,
      filePath: candidate.filePath,
      repoId: candidate.repoId,
      impactScope: 'local-symbol',
      confidence: 'low',
      evidence: [evidence],
    });
  }

  return impacts.sort((left, right) => compareSymbols(left, right));
}

async function collectImporterImpacts(target: IndexedSymbol): Promise<{
  files: ImpactedFile[];
  symbols: ImpactedSymbol[];
}> {
  const [importingFiles, targetRelation] = await Promise.all([
    getImportingFiles(target.fileId),
    getFileRelationById(target.fileId),
  ]);

  if (!targetRelation) {
    return { files: [], symbols: [] };
  }

  const { names: exportedNames, hasDefault } = getTargetExportNames(target, targetRelation.exports);
  const files: ImpactedFile[] = [];
  const symbols: ImpactedSymbol[] = [];

  for (const importingFile of importingFiles) {
    const [relation, definedSymbols, content] = await Promise.all([
      getFileRelationById(importingFile.fileId),
      getDefinedSymbols(importingFile.fileId),
      getFileContent(importingFile.repoId, importingFile.filePath),
    ]);

    const importerFileEvidence = buildEvidence(
      'imports-target',
      'medium',
      importingFile.filePath,
      ['file directly imports the target file through a graph-known import edge; symbol-level usage inside the file is not confirmed by this evidence alone'],
      'file-direct',
      'graph',
    );

    files.push({
      file: importingFile,
      fileId: importingFile.fileId,
      filePath: importingFile.filePath,
      repoId: importingFile.repoId,
      impactScope: 'file-direct',
      confidence: 'medium',
      evidence: [importerFileEvidence],
    });

    if (!relation) {
      continue;
    }

    const matchingBindings = relation.imports.flatMap((entry) => {
      if (!importSourceLikelyTargetsFile(entry.source, target.filePath)) {
        return [];
      }

      return entry.bindings
        .filter((binding) => bindingTargetsSymbol(binding, exportedNames, hasDefault))
        .map((binding) => ({
          ...binding,
          source: entry.source,
        }));
    });

    if (!content || matchingBindings.length === 0) {
      continue;
    }

    for (const definedSymbol of definedSymbols) {
      const slice = lineSlice(content, definedSymbol.startLine, definedSymbol.endLine);
      const referencedBinding = matchingBindings.find((binding) => containsIdentifier(slice, binding.localName));

      if (!referencedBinding) {
        continue;
      }

      const symbolFile = await getFileNode(definedSymbol.fileId);
      const symbolEvidence = buildEvidence(
        'imports-target',
        'high',
        definedSymbol.filePath,
        [`symbol span references imported binding "${referencedBinding.localName}" from "${referencedBinding.source}", tied to the target export surface`],
        'symbol-direct',
        'symbol-index',
        definedSymbol.symbolId,
        definedSymbol.name,
      );

      symbols.push({
        symbol: definedSymbol,
        file: symbolFile,
        symbolId: definedSymbol.symbolId,
        symbolName: definedSymbol.name,
        kind: definedSymbol.kind,
        exported: definedSymbol.exported,
        filePath: definedSymbol.filePath,
        repoId: definedSymbol.repoId,
        impactScope: 'symbol-direct',
        confidence: 'high',
        evidence: [symbolEvidence],
      });
    }
  }

  return { files, symbols };
}

async function collectReexportImpacts(target: IndexedSymbol): Promise<{
  files: ImpactedFile[];
  symbols: ImpactedSymbol[];
}> {
  const reexportingFiles = await getReexportingFiles(target.fileId);
  const files: ImpactedFile[] = [];
  const symbols: ImpactedSymbol[] = [];

  for (const reexportingFile of reexportingFiles) {
    const [relation, definedSymbols, content] = await Promise.all([
      getFileRelationById(reexportingFile.fileId),
      getDefinedSymbols(reexportingFile.fileId),
      getFileContent(reexportingFile.repoId, reexportingFile.filePath),
    ]);

    const evidence = buildEvidence(
      'reexports-target',
      'medium',
      reexportingFile.filePath,
      ['file re-exports the target file through a resolved local re-export edge; downstream consumer usage is not confirmed by this evidence alone'],
      'proxy',
      'graph',
    );

    files.push({
      file: reexportingFile,
      fileId: reexportingFile.fileId,
      filePath: reexportingFile.filePath,
      repoId: reexportingFile.repoId,
      impactScope: 'proxy',
      confidence: 'medium',
      evidence: [evidence],
    });

    if (!relation || !content) {
      continue;
    }

    const hasNamedLocalReference = relation.exports.some(
      (entry) =>
        entry.kind === 'named' &&
        (entry.symbolId === target.symbolId || entry.localName === target.name),
    );

    if (!hasNamedLocalReference) {
      continue;
    }

    for (const definedSymbol of definedSymbols) {
      const slice = lineSlice(content, definedSymbol.startLine, definedSymbol.endLine);

      if (!containsIdentifier(slice, target.name)) {
        continue;
      }

      const symbolFile = await getFileNode(definedSymbol.fileId);
      const symbolEvidence = buildEvidence(
        'reexports-target',
        'low',
        definedSymbol.filePath,
        ['same-file symbol span references a local symbol that is re-exported from this file; this is a barrel-proxy signal, not a confirmed downstream consumer reference'],
        'proxy',
        'symbol-index',
        definedSymbol.symbolId,
        definedSymbol.name,
      );

      symbols.push({
        symbol: definedSymbol,
        file: symbolFile,
        symbolId: definedSymbol.symbolId,
        symbolName: definedSymbol.name,
        kind: definedSymbol.kind,
        exported: definedSymbol.exported,
        filePath: definedSymbol.filePath,
        repoId: definedSymbol.repoId,
        impactScope: 'proxy',
        confidence: 'low',
        evidence: [symbolEvidence],
      });
    }
  }

  return { files, symbols };
}

function mergeImpactedFiles(entries: ImpactedFile[]): ImpactedFile[] {
  const byFile = new Map<string, ImpactedFile>();

  for (const entry of entries) {
    const key = entry.fileId ?? entry.filePath;
    const existing = byFile.get(key);

    if (!existing) {
      byFile.set(key, entry);
      continue;
    }

    existing.evidence.push(...entry.evidence);
    existing.confidence = pickConfidence(existing.evidence);
  }

  return Array.from(byFile.values())
    .sort((left, right) => compareEvidence(left.evidence, right.evidence) || compareFiles(left, right));
}

function mergeImpactedSymbols(entries: ImpactedSymbol[]): ImpactedSymbol[] {
  const bySymbol = new Map<string, ImpactedSymbol>();

  for (const entry of entries) {
    const key = entry.symbolId ?? `${entry.filePath}:${entry.symbolName}`;
    const existing = bySymbol.get(key);

    if (!existing) {
      bySymbol.set(key, entry);
      continue;
    }

    existing.evidence.push(...entry.evidence);
    existing.confidence = pickConfidence(existing.evidence);
  }

  return Array.from(bySymbol.values())
    .sort((left, right) => compareEvidence(left.evidence, right.evidence) || compareSymbols(left, right));
}

function buildSummary(
  files: ImpactedFile[],
  symbols: ImpactedSymbol[],
  transitiveImpacts: TransitiveImpact[],
  notes: string[],
): ImpactAnalysisSummary {
  const impacts = [
    ...files.map((entry) => entry.confidence),
    ...symbols.map((entry) => entry.confidence),
  ];
  const symbolDirectImpactCount = symbols.filter((entry) => entry.impactScope === 'symbol-direct').length;
  const fileDirectImpactCount = files.filter((entry) => entry.impactScope === 'file-direct').length;
  const proxyImpactCount =
    files.filter((entry) => entry.impactScope === 'proxy').length +
    symbols.filter((entry) => entry.impactScope === 'proxy').length;
  const localSymbolImpactCount = symbols.filter((entry) => entry.impactScope === 'local-symbol').length;
  const overviewParts: string[] = [];

  if (symbolDirectImpactCount > 0) {
    overviewParts.push(`${symbolDirectImpactCount} symbol-direct`);
  }

  if (fileDirectImpactCount > 0) {
    overviewParts.push(`${fileDirectImpactCount} file-level importer`);
  }

  if (proxyImpactCount > 0) {
    overviewParts.push(`${proxyImpactCount} proxy`);
  }

  if (localSymbolImpactCount > 0) {
    overviewParts.push(`${localSymbolImpactCount} local same-file`);
  }

  const overview =
    overviewParts.length > 0
      ? `likely direct impacts identified from graph and local evidence: ${overviewParts.join(', ')}`
      : 'no likely direct impacts identified from the current safe-mode evidence';

  return {
    directFileCount: files.length,
    directSymbolCount: symbols.length,
    transitiveFileCount: transitiveImpacts.filter((entry) => entry.file).length,
    transitiveSymbolCount: transitiveImpacts.filter((entry) => entry.symbol).length,
    highConfidenceImpactCount: impacts.filter((entry) => entry === 'high').length,
    mediumConfidenceImpactCount: impacts.filter((entry) => entry === 'medium').length,
    lowConfidenceImpactCount: impacts.filter((entry) => entry === 'low').length,
    symbolDirectImpactCount,
    fileDirectImpactCount,
    proxyImpactCount,
    localSymbolImpactCount,
    overview,
    ambiguityDetected: false,
    notes,
  };
}

export async function analyzeSymbolImpact(input: AnalyzeSymbolImpactInput): Promise<ImpactAnalysisResult> {
  const target = await resolveTarget(input);

  if (!target.symbol || !target.file || !target.repoId) {
    return buildMissingResult(input, ['target symbol could not be resolved from the current symbol index and graph']);
  }

  const notes: string[] = [];

  if (input.mode === 'exploratory') {
    notes.push('exploratory mode currently reuses the same direct safe-mode evidence; broader traversal and transitive impact expansion are not implemented yet');
  }

  if ((input.maxDepth ?? DEFAULT_MAX_DEPTH) > 1 || input.includeTransitive) {
    notes.push('transitive expansion is not implemented yet; result includes direct impacts only');
  }

  const [sameFileSymbols, importerImpacts, reexportImpacts] = await Promise.all([
    collectSameFileImpacts(target.symbol),
    collectImporterImpacts(target.symbol),
    collectReexportImpacts(target.symbol),
  ]);

  const directlyImpactedSymbols = mergeImpactedSymbols([
    ...sameFileSymbols,
    ...importerImpacts.symbols,
    ...reexportImpacts.symbols,
  ]);
  const directlyImpactedFiles = mergeImpactedFiles([
    ...importerImpacts.files,
    ...reexportImpacts.files,
  ]);
  const transitiveImpacts: TransitiveImpact[] = [];

  if (directlyImpactedFiles.length > 0) {
    notes.push('direct importer files and re-export files are file-level or proxy impact signals unless symbol-level usage is separately confirmed');
  }

  if (sameFileSymbols.length > 0) {
    notes.push('same-file symbol impacts are based on exact symbol-name matches inside sibling symbol spans and should be treated as local proxy evidence');
  }

  return {
    mode: input.mode,
    target,
    directlyImpactedSymbols,
    directlyImpactedFiles,
    transitiveImpacts,
    publicSurfaceRisk: {
      level: 'unknown',
      notes: ['public surface risk is not derived in phase 5.1 step B'],
    },
    summary: buildSummary(directlyImpactedFiles, directlyImpactedSymbols, transitiveImpacts, notes),
  };
}
