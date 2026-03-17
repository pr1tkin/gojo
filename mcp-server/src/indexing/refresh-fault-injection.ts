import type { RefreshFaultMode, RefreshFaultStage } from './types.js';

export interface RefreshFaultInjectionConfig {
  stage: RefreshFaultStage;
  mode: RefreshFaultMode;
  target?: string;
}

export interface RefreshFaultInjectionContext {
  stage: RefreshFaultStage;
  generationId?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  target?: string;
  onPartialWrite?: () => Promise<void>;
  onSkipStep?: () => Promise<void> | void;
}

export interface RefreshFaultInjectionResult {
  injected: boolean;
  skipped: boolean;
  warning?: string;
}

const STAGES: RefreshFaultStage[] = [
  'before-snapshot',
  'after-snapshot',
  'after-change-detection',
  'rebuild-symbols',
  'rebuild-graph',
  'rebuild-patterns',
  'persist-artifacts',
  'before-commit',
  'coordination-update',
  'consistency-maintenance',
];

const MODES: RefreshFaultMode[] = ['throw', 'crash', 'partial-write', 'skip-step'];

export class RefreshFaultInjectedError extends Error {
  constructor(
    readonly stage: RefreshFaultStage,
    readonly mode: RefreshFaultMode,
    readonly target?: string,
  ) {
    super(`Injected refresh fault at ${stage} using ${mode}${target ? ` (${target})` : ''}`);
    this.name = 'RefreshFaultInjectedError';
  }

  get simulatesCrash(): boolean {
    return this.mode === 'crash';
  }
}

function normalizeStage(value: string | undefined): RefreshFaultStage | null {
  if (!value) {
    return null;
  }

  return STAGES.includes(value as RefreshFaultStage) ? (value as RefreshFaultStage) : null;
}

function normalizeMode(value: string | undefined): RefreshFaultMode | null {
  if (!value) {
    return null;
  }

  return MODES.includes(value as RefreshFaultMode) ? (value as RefreshFaultMode) : null;
}

export function resolveRefreshFaultInjection(
  configured?: RefreshFaultInjectionConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): RefreshFaultInjectionConfig | null {
  if (configured) {
    return configured;
  }

  const stage = normalizeStage(env.REPORADAR_FAULT_INJECTION_STAGE ?? env.FAULT_INJECTION_STAGE);
  const mode = normalizeMode(env.REPORADAR_FAULT_INJECTION_MODE ?? env.FAULT_INJECTION_MODE);
  const target = env.REPORADAR_FAULT_INJECTION_TARGET ?? env.FAULT_INJECTION_TARGET;

  if (!stage || !mode) {
    return null;
  }

  return { stage, mode, target: target?.trim() || undefined };
}

function matchesTarget(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected) {
    return true;
  }

  return expected === actual;
}

export async function applyRefreshFaultInjection(
  config: RefreshFaultInjectionConfig | null,
  context: RefreshFaultInjectionContext,
): Promise<RefreshFaultInjectionResult> {
  if (!config || config.stage !== context.stage || !matchesTarget(config.target, context.target)) {
    return { injected: false, skipped: false };
  }

  const logger = context.logger ?? console;
  const description = `stage=${config.stage} mode=${config.mode}${config.target ? ` target=${config.target}` : ''}`;

  switch (config.mode) {
    case 'throw':
    case 'crash':
      logger.warn(`[fault-injection] injecting ${description}`);
      throw new RefreshFaultInjectedError(config.stage, config.mode, config.target);
    case 'partial-write':
      if (!context.onPartialWrite) {
        throw new Error(`Fault mode partial-write is not supported at stage ${config.stage}`);
      }

      logger.warn(`[fault-injection] injecting ${description}`);
      await context.onPartialWrite();
      return {
        injected: true,
        skipped: false,
        warning: `fault injected at ${config.stage} using partial-write${config.target ? ` (${config.target})` : ''}`,
      };
    case 'skip-step':
      logger.warn(`[fault-injection] injecting ${description}`);
      await context.onSkipStep?.();
      return {
        injected: true,
        skipped: true,
        warning: `fault injected at ${config.stage} using skip-step${config.target ? ` (${config.target})` : ''}`,
      };
  }
}
