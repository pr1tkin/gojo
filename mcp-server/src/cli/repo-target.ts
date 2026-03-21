import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import type { CliCommand, RepoResolutionContext, ResolvedRepoTarget } from './types.js';

async function existingDirectory(candidatePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(candidatePath);

    if (!stat.isDirectory()) {
      return null;
    }

    return await fs.realpath(candidatePath);
  } catch {
    return null;
  }
}

function looksLikePath(value: string): boolean {
  return (
    value.includes('/') ||
    value.includes('\\') ||
    value.startsWith('.') ||
    path.isAbsolute(value)
  );
}

async function resolveRepoIdToPath(
  repoId: string,
  context: RepoResolutionContext,
): Promise<string | null> {
  const currentGeneration = await loadCurrentGenerationState().catch(() => null);
  const currentGenerationMatch = currentGeneration?.repositories.find((repository) => repository.repoId === repoId);

  if (currentGenerationMatch?.repoRoot) {
    return currentGenerationMatch.repoRoot;
  }

  const configuredCandidate = await existingDirectory(path.join(context.config.reposRoot, repoId));
  if (configuredCandidate) {
    return configuredCandidate;
  }

  const workspaceCandidate = await existingDirectory(path.resolve(context.cwd, '..', 'repos', repoId));
  if (workspaceCandidate) {
    return workspaceCandidate;
  }

  return null;
}

async function resolveExplicitPath(value: string, context: RepoResolutionContext): Promise<string | null> {
  return existingDirectory(path.resolve(context.cwd, value));
}

export async function resolveRepoTarget(
  repoInput: string | undefined,
  context: RepoResolutionContext,
): Promise<ResolvedRepoTarget | undefined> {
  if (!repoInput) {
    return undefined;
  }

  if (looksLikePath(repoInput)) {
    const repoPath = await resolveExplicitPath(repoInput, context);

    if (!repoPath) {
      throw new Error(`Repo path does not exist: ${repoInput}`);
    }

    return {
      repoPath,
      repoId: path.basename(repoPath),
    };
  }

  const repoPath = await resolveRepoIdToPath(repoInput, context);

  if (!repoPath) {
    throw new Error(`Repo could not be resolved: ${repoInput}`);
  }

  return {
    repoId: repoInput,
    repoPath,
  };
}

export async function finalizeCliCommand(
  command: CliCommand,
  context: RepoResolutionContext,
): Promise<CliCommand> {
  const resolvedRepoTarget = await resolveRepoTarget(command.repoInput, context);
  const executionContext = {
    ...command.executionContext,
    ...(resolvedRepoTarget ? { repoTarget: resolvedRepoTarget } : {}),
  };

  if (command.capability === 'IndexRepo') {
    const indexPathInput = command.indexPathInput ?? command.repoInput;

    if (!indexPathInput) {
      return {
        ...command,
        executionContext,
      };
    }

    const resolvedIndexTarget = await resolveRepoTarget(indexPathInput, context);

    if (!resolvedIndexTarget?.repoPath) {
      throw new Error(`Repo path does not exist: ${indexPathInput}`);
    }

    return {
      ...command,
      request: {
        repo: {
          repoPath: resolvedIndexTarget.repoPath,
          ...(resolvedIndexTarget.repoId ? { repoId: resolvedIndexTarget.repoId } : {}),
        },
      },
      executionContext,
    };
  }

  if (command.capability === 'ExploreComponent' || command.capability === 'RunHealthChecks') {
    return {
      ...command,
      request: {
        ...command.request,
        ...(resolvedRepoTarget ? { repo: resolvedRepoTarget } : {}),
      },
      executionContext,
    };
  }

  return {
    ...command,
    executionContext,
  };
}
