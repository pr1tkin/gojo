import path from 'node:path';

import type { PatternCandidate, PatternFingerprint, PatternPrecedentFamily } from './types.js';

interface InferredPatternFamilyDetails {
  family: PatternPrecedentFamily;
  reason: string;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tokenizeName(value: string): string[] {
  return dedupe(
    value
      .replace(/\.[^.]+$/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getRelativeFilePath(fileId: string): string {
  const separatorIndex = fileId.indexOf(':');
  return separatorIndex >= 0 ? fileId.slice(separatorIndex + 1) : fileId;
}

function hasAnyToken(tokens: string[], expected: string[]): boolean {
  return expected.some((token) => tokens.includes(token));
}

export function getPatternPrecedentFamilyLabel(family: PatternPrecedentFamily): string {
  switch (family) {
    case 'ui_component':
      return 'component';
    case 'ui_wrapper_or_shell':
      return 'wrapper';
    case 'page':
    case 'routed_page_or_screen':
      return 'page';
    case 'hook_or_context':
      return 'hook/context';
    case 'state_or_store':
      return 'store/context';
    case 'util_or_helper':
      return 'utility';
    case 'api_or_handler':
      return 'API/handler';
    case 'module_or_integration':
      return 'module';
    case 'support_runtime':
      return 'support';
    default:
      return 'runtime';
  }
}

export function arePatternFamiliesCompatible(
  left: PatternPrecedentFamily,
  right: PatternPrecedentFamily,
): boolean {
  return (
    left === right ||
    (left === 'page' && right === 'routed_page_or_screen') ||
    (left === 'routed_page_or_screen' && right === 'page') ||
    (left === 'hook_or_context' && right === 'state_or_store') ||
    (left === 'state_or_store' && right === 'hook_or_context')
  );
}

export function inferPatternPrecedentFamily(pattern: Pick<PatternCandidate, 'fileId' | 'name' | 'kind' | 'fingerprint'>): PatternPrecedentFamily {
  return inferPatternPrecedentFamilyDetails(pattern).family;
}

export function inferPatternPrecedentFamilyDetails(
  pattern: Pick<PatternCandidate, 'fileId' | 'name' | 'kind' | 'fingerprint'>,
): InferredPatternFamilyDetails {
  if (pattern.fingerprint.precedentFamily) {
    return {
      family: pattern.fingerprint.precedentFamily,
      reason: pattern.fingerprint.precedentFamilyReason ?? 'pre-classified family',
    };
  }

  const relativeFilePath = getRelativeFilePath(pattern.fileId).toLowerCase();
  const baseName = path.posix.basename(relativeFilePath);
  const responsibilityTokens = pattern.fingerprint.responsibilitySignals ?? [];
  const nameTokens = tokenizeName(pattern.name);
  const runtimeTokens = dedupe([
    ...tokenizeName(baseName),
    ...nameTokens,
    ...responsibilityTokens.flatMap((entry) => tokenizeName(entry)),
  ]);
  const structuralSignals = new Set(pattern.fingerprint.structuralSignals);
  const hasStateTokens = hasAnyToken(runtimeTokens, ['context', 'provider', 'store', 'state', 'reducer', 'slice']);
  const hasWrapperTokens = hasAnyToken(runtimeTokens, ['wrapper', 'shell', 'layout', 'container', 'boundary', 'frame']);
  const hasComponentDirectoryCue =
    relativeFilePath.includes('/_components/') ||
    relativeFilePath.includes('/components/') ||
    relativeFilePath.includes('/ui/');
  const hasCanonicalPageName =
    baseName === 'page.tsx' ||
    baseName === 'page.jsx' ||
    baseName === 'screen.tsx' ||
    baseName === 'screen.jsx';
  const hasRouteLikePathCue =
    pattern.kind === 'component' &&
    (
      relativeFilePath.includes('/app/') ||
      relativeFilePath.includes('/pages/') ||
      relativeFilePath.includes('/screen') ||
      /\[[^\]]+\]/.test(relativeFilePath)
    );
  const hasPageNameCue =
    hasCanonicalPageName ||
    nameTokens.includes('page') ||
    nameTokens.includes('screen') ||
    responsibilityTokens.some((entry) => /page|screen|route/i.test(entry));
  const hasComponentSemanticCue =
    pattern.kind === 'component' &&
    (
      hasComponentDirectoryCue ||
      pattern.fingerprint.symbolRole === 'component' ||
      structuralSignals.has('react-function-component') ||
      structuralSignals.has('jsx-return')
    );
  const hasStrongPageCue = hasPageNameCue && (hasRouteLikePathCue || hasCanonicalPageName);

  if (pattern.kind === 'test-suite' || pattern.kind === 'storybook-story') {
    return { family: 'support_runtime', reason: 'support artifact semantics' };
  }

  if (pattern.kind === 'api-handler') {
    return { family: 'api_or_handler', reason: 'API handler kind' };
  }

  if (pattern.kind === 'hook') {
    return hasStateTokens
      ? { family: 'state_or_store', reason: 'store/context semantics outranked hook defaults' }
      : { family: 'hook_or_context', reason: 'hook semantics' };
  }

  if (hasStateTokens) {
    return pattern.kind === 'component'
      ? { family: 'state_or_store', reason: 'store/context semantics outranked generic component cues' }
      : { family: 'hook_or_context', reason: 'context semantics' };
  }

  if (pattern.kind === 'component') {
    // Precedence is explicit here: strong component semantics outrank route-like path cues,
    // but canonical page/screen files still keep routed-page classification.
    if (hasStrongPageCue && !hasComponentDirectoryCue) {
      return { family: 'routed_page_or_screen', reason: 'canonical page/screen cues outranked generic component cues' };
    }

    if (hasComponentSemanticCue) {
      return hasWrapperTokens
        ? {
            family: 'ui_wrapper_or_shell',
            reason: hasRouteLikePathCue
              ? 'component semantics outranked route-path cues, then wrapper cues applied'
              : 'wrapper component semantics',
          }
        : {
            family: 'ui_component',
            reason: hasRouteLikePathCue
              ? 'component semantics outranked route-path cues'
              : 'component semantics',
          };
    }

    if (hasStrongPageCue) {
      return { family: 'routed_page_or_screen', reason: 'page/screen semantics' };
    }

    return hasWrapperTokens
      ? { family: 'ui_wrapper_or_shell', reason: 'wrapper component semantics' }
      : { family: 'ui_component', reason: 'default component semantics' };
  }

  if (
    relativeFilePath.includes('/api/') ||
    relativeFilePath.includes('/server/') ||
    relativeFilePath.includes('/actions/')
  ) {
    return { family: 'api_or_handler', reason: 'server/API path cues' };
  }

  if (hasWrapperTokens) {
    return { family: 'ui_wrapper_or_shell', reason: 'wrapper/path cues' };
  }

  if (
    relativeFilePath.includes('/integration') ||
    relativeFilePath.includes('/adapters/') ||
    relativeFilePath.includes('/clients/') ||
    relativeFilePath.includes('/connectors/') ||
    pattern.kind === 'service-layer' ||
    pattern.kind === 'data-access'
  ) {
    return { family: 'module_or_integration', reason: 'integration/service cues' };
  }

  if (pattern.kind === 'utility-export') {
    return relativeFilePath.includes('/utils/') || relativeFilePath.includes('/helpers/')
      ? { family: 'util_or_helper', reason: 'utility/helper path cues' }
      : { family: 'module_or_integration', reason: 'utility export without helper path cues' };
  }

  return { family: 'module_or_integration', reason: 'default module/integration fallback' };
}

export function withInferredPatternFamily(fingerprint: PatternFingerprint, candidate: Pick<PatternCandidate, 'fileId' | 'name' | 'kind' | 'fingerprint'>): PatternFingerprint {
  if (fingerprint.precedentFamily) {
    return fingerprint;
  }

  const inferred = inferPatternPrecedentFamilyDetails(candidate);

  return {
    ...fingerprint,
    precedentFamily: inferred.family,
    precedentFamilyReason: inferred.reason,
  };
}
