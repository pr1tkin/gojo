import path from 'node:path';

import type { PatternCandidate, PatternFingerprint, PatternPrecedentFamily } from './types.js';

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
  if (pattern.fingerprint.precedentFamily) {
    return pattern.fingerprint.precedentFamily;
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
  const hasStateTokens = hasAnyToken(runtimeTokens, ['context', 'provider', 'store', 'state', 'reducer', 'slice']);
  const hasWrapperTokens = hasAnyToken(runtimeTokens, ['wrapper', 'shell', 'layout', 'container', 'boundary', 'frame']);
  const isRoutedPage =
    pattern.kind === 'component' &&
    (
      relativeFilePath.includes('/app/') ||
      relativeFilePath.includes('/pages/') ||
      relativeFilePath.includes('/screen') ||
      baseName === 'page.tsx' ||
      baseName === 'page.jsx' ||
      baseName === 'screen.tsx' ||
      baseName === 'screen.jsx'
    );

  if (pattern.kind === 'test-suite' || pattern.kind === 'storybook-story') {
    return 'support_runtime';
  }

  if (pattern.kind === 'api-handler') {
    return 'api_or_handler';
  }

  if (pattern.kind === 'hook') {
    return hasStateTokens ? 'state_or_store' : 'hook_or_context';
  }

  if (pattern.kind === 'component' && isRoutedPage) {
    return 'routed_page_or_screen';
  }

  if (hasStateTokens) {
    return pattern.kind === 'component' ? 'state_or_store' : 'hook_or_context';
  }

  if (pattern.kind === 'component') {
    return hasWrapperTokens ? 'ui_wrapper_or_shell' : 'ui_component';
  }

  if (
    relativeFilePath.includes('/api/') ||
    relativeFilePath.includes('/server/') ||
    relativeFilePath.includes('/actions/')
  ) {
    return 'api_or_handler';
  }

  if (hasWrapperTokens) {
    return 'ui_wrapper_or_shell';
  }

  if (
    relativeFilePath.includes('/integration') ||
    relativeFilePath.includes('/adapters/') ||
    relativeFilePath.includes('/clients/') ||
    relativeFilePath.includes('/connectors/') ||
    pattern.kind === 'service-layer' ||
    pattern.kind === 'data-access'
  ) {
    return 'module_or_integration';
  }

  if (pattern.kind === 'utility-export') {
    return relativeFilePath.includes('/utils/') || relativeFilePath.includes('/helpers/')
      ? 'util_or_helper'
      : 'module_or_integration';
  }

  return 'module_or_integration';
}

export function withInferredPatternFamily(fingerprint: PatternFingerprint, candidate: Pick<PatternCandidate, 'fileId' | 'name' | 'kind' | 'fingerprint'>): PatternFingerprint {
  if (fingerprint.precedentFamily) {
    return fingerprint;
  }

  return {
    ...fingerprint,
    precedentFamily: inferPatternPrecedentFamily(candidate),
  };
}
