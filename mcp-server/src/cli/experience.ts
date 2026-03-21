import type { RuntimeResponse } from '../runtime/index.js';
import { SearchHelperError } from '../search/helpers.js';
import type { CliCommand, CliStructuredError } from './types.js';

function repoLabel(command: CliCommand): string | undefined {
  const repoTarget = command.executionContext.repoTarget;
  return repoTarget?.repoPath ?? repoTarget?.repoId;
}

function commandForIndex(command: CliCommand): string {
  const repoTarget = command.executionContext.repoTarget;
  if (repoTarget?.repoPath) {
    return `gojo index ${repoTarget.repoPath}`;
  }

  if (repoTarget?.repoId) {
    return `gojo index --repo ${repoTarget.repoId}`;
  }

  return 'gojo index';
}

function commandForRefresh(command: CliCommand): string {
  const repoTarget = command.executionContext.repoTarget;
  if (repoTarget?.repoId) {
    return `gojo refresh --repo ${repoTarget.repoId}`;
  }

  if (repoTarget?.repoPath) {
    return `gojo refresh --repo ${repoTarget.repoPath}`;
  }

  return 'gojo refresh';
}

function commandForHealth(command: CliCommand): string {
  const repoTarget = command.executionContext.repoTarget;
  if (repoTarget?.repoId) {
    return `gojo health --repo ${repoTarget.repoId}`;
  }

  if (repoTarget?.repoPath) {
    return `gojo health --repo ${repoTarget.repoPath}`;
  }

  return 'gojo health';
}

function appendUnique(target: string[], value: string | undefined): void {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

function commandForRetryExplore(command: CliCommand): string | undefined {
  if (command.capability !== 'ExploreComponent') {
    return undefined;
  }

  const request = command.request as { target?: string };
  if (!request.target) {
    return undefined;
  }

  const repoTarget = command.executionContext.repoTarget;
  if (repoTarget?.repoId) {
    return `gojo explore ${request.target} --repo ${repoTarget.repoId}`;
  }

  if (repoTarget?.repoPath) {
    return `gojo explore ${request.target} --repo ${repoTarget.repoPath}`;
  }

  return `gojo explore ${request.target}`;
}

function isMissingIndexError(error: unknown): boolean {
  return error instanceof Error && /Symbol index not found/i.test(error.message);
}

function isRepoResolutionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('Repo path does not exist:') ||
      error.message.startsWith('Repo could not be resolved:'))
  );
}

function isUsageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('Usage:') ||
      error.message.includes('Unknown command') ||
      error.message.includes('requires a <target>') ||
      error.message.includes('Missing value for --repo'))
  );
}

function isSearchHelperError(error: unknown): error is SearchHelperError {
  return error instanceof SearchHelperError;
}

export function getCliExitCode(error: unknown): number {
  return isUsageError(error) ? 2 : 1;
}

export function buildCliStructuredError(error: unknown, command?: CliCommand): CliStructuredError {
  if (isUsageError(error)) {
    return {
      ok: false,
      error: {
        code: 'invalid_usage',
        title: 'Invalid command usage',
        reason: error instanceof Error ? error.message : String(error),
        how_to_fix: ['Review the command usage and provide the required arguments.'],
        suggested_commands: [],
      },
    };
  }

  if (isMissingIndexError(error) && command?.capability === 'ExploreComponent') {
    const target = (command.request as { target?: string }).target ?? 'the requested target';
    const repo = repoLabel(command);
    const reason = repo
      ? `No symbol index is available for ${repo}, so Gojo cannot explore ${target} yet.`
      : `No symbol index is available yet, so Gojo cannot explore ${target}.`;
    const suggestedCommands = [
      commandForIndex(command),
      ...(commandForRetryExplore(command) ? [commandForRetryExplore(command)!] : []),
      commandForHealth(command),
    ];

    return {
      ok: false,
      error: {
        code: 'missing_index',
        title: `Cannot explore ${target} yet`,
        reason,
        how_to_fix: [
          `Run ${commandForIndex(command)} to create the required symbol index.`,
          ...(commandForRetryExplore(command)
            ? [`Then retry with ${commandForRetryExplore(command)}.`]
            : []),
        ],
        suggested_commands: suggestedCommands,
        details: {
          capability: command.capability,
          ...(repo ? { repo } : {}),
        },
      },
    };
  }

  if (isRepoResolutionError(error)) {
    return {
      ok: false,
      error: {
        code: 'invalid_repo_target',
        title: 'Repo target could not be resolved',
        reason: error instanceof Error ? error.message : String(error),
        how_to_fix: [
          'Pass an existing filesystem path for indexing, or a repo id/path that Gojo can resolve.',
          'If the repo has already been indexed, use its repo id. Otherwise use the filesystem path.',
        ],
        suggested_commands: ['gojo health'],
      },
    };
  }

  if (isSearchHelperError(error)) {
    return {
      ok: false,
      error: {
        code: 'missing_search_helper',
        title: 'Search helper is unavailable',
        reason: error.message,
        how_to_fix:
          error.suggestions.length > 0
            ? error.suggestions
            : ['Reinstall Gojo so the bundled search helpers are present and executable.'],
        suggested_commands: command ? [commandForHealth(command)] : ['gojo health'],
        details: {
          helper: error.helper,
          code: error.code,
          ...(command
            ? {
                capability: command.capability,
                command: command.name,
              }
            : {}),
        },
      },
    };
  }

  return {
    ok: false,
      error: {
        code: 'runtime_failure',
        title: command ? `Command failed: ${command.name}` : 'Command failed',
        reason: error instanceof Error ? error.message : String(error),
      how_to_fix: [
        'Check the reported reason and retry once the runtime prerequisites are satisfied.',
      ],
      suggested_commands: command ? [commandForHealth(command)] : ['gojo health'],
      details: command
        ? {
            capability: command.capability,
            command: command.name,
          }
        : undefined,
    },
  };
}

export function deriveSuggestedCommands(response: RuntimeResponse<unknown>, command: CliCommand): string[] {
  const suggestions: string[] = [];

  if (response.capability === 'RunHealthChecks') {
    const payload = response.machine_payload as {
      trustState?: string;
      generationStatus?: string;
      suitableForAgentWorkflows?: boolean;
      readinessState?: string;
      recommendedAction?: string;
    };

    if (payload.generationStatus === 'missing' || response.readiness_state === 'unknown') {
      appendUnique(suggestions, commandForIndex(command));
    }

    if (payload.readinessState === 'stale' || response.readiness_state === 'stale') {
      appendUnique(suggestions, commandForRefresh(command));
    }

    if (payload.readinessState === 'inconsistent' || response.readiness_state === 'inconsistent') {
      appendUnique(suggestions, commandForIndex(command));
    }
  }

  if (response.capability === 'ExploreComponent') {
    if (response.readiness_state === 'stale') {
      appendUnique(suggestions, commandForRefresh(command));
    }

    if (response.readiness_state === 'inconsistent' || response.readiness_state === 'unknown') {
      appendUnique(suggestions, commandForIndex(command));
    }

    if (response.readiness_state !== 'ready') {
      appendUnique(suggestions, commandForHealth(command));
    }
  }

  if (response.capability === 'IndexRepo' && response.readiness_state === 'stale') {
    appendUnique(suggestions, commandForRefresh(command));
  }

  if (response.capability === 'RefreshRepo') {
    if (response.readiness_state === 'stale') {
      appendUnique(suggestions, commandForHealth(command));
    }

    if (response.readiness_state === 'inconsistent' || response.readiness_state === 'unknown') {
      appendUnique(suggestions, commandForIndex(command));
    }
  }

  return suggestions;
}
