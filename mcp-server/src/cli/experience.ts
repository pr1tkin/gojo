import type { RuntimeResponse } from '../runtime/index.js';
import type { CliCommand, CliStructuredError } from './types.js';

function repoLabel(command: CliCommand): string | undefined {
  const repoTarget = command.executionContext.repoTarget;
  return repoTarget?.repoId ?? repoTarget?.repoPath;
}

function commandForIndex(command: CliCommand): string {
  const repo = repoLabel(command);
  return repo ? `gojo index --repo ${repo}` : 'gojo index';
}

function commandForHealth(command: CliCommand): string {
  const repo = repoLabel(command);
  return repo ? `gojo health --repo ${repo}` : 'gojo health';
}

function commandForRetryExplore(command: CliCommand): string | undefined {
  if (command.capability !== 'ExploreComponent') {
    return undefined;
  }

  const request = command.request as { target?: string };
  if (!request.target) {
    return undefined;
  }

  const repo = repoLabel(command);
  return repo ? `gojo explore ${request.target} --repo ${repo}` : `gojo explore ${request.target}`;
}

function isMissingIndexError(error: unknown): boolean {
  return error instanceof Error && /Symbol index not found/i.test(error.message);
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
