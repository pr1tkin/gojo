import type { RuntimeResponse } from '../runtime/index.js';
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
    };

    if (payload.generationStatus === 'missing') {
      suggestions.push(commandForIndex(command));
    }
  }

  if (response.capability === 'ExploreComponent' && response.trust !== 'high') {
    suggestions.push(commandForHealth(command));
  }

  return suggestions;
}
