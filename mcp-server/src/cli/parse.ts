import type { ParsedCliResult } from './types.js';

const usageText = `Usage:
  gojo [--repo <repo-id-or-path>] [--json] [--debug] index [repo-path]
  gojo [--repo <repo-id-or-path>] [--json] [--debug] explore <target>
  gojo [--repo <repo-id-or-path>] [--json] [--debug] health
  gojo [--repo <repo-id-or-path>] [--json] [--debug] mcp serve
`;

function isFlag(value: string): boolean {
  return value.startsWith('--');
}

function parseGlobalOptions(argv: string[]): {
  options: { repo?: string; json: boolean; debug: boolean };
  rest: string[];
} {
  const options = {
    json: false,
    debug: false,
  } as { repo?: string; json: boolean; debug: boolean };
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (token === '--debug') {
      options.debug = true;
      continue;
    }

    if (token === '--repo') {
      const value = argv[index + 1];

      if (!value || isFlag(value)) {
        throw new Error('Missing value for --repo');
      }

      options.repo = value;
      index += 1;
      continue;
    }

    rest.push(token);
  }

  return { options, rest };
}

function classifyRepoTarget(value: string | undefined): { repoId?: string; repoPath?: string } | undefined {
  if (!value) {
    return undefined;
  }

  if (
    value.includes('/') ||
    value.includes('\\') ||
    value.startsWith('.') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return { repoPath: value };
  }

  return { repoId: value };
}

function toExecutionContext(input: { repo?: string; json: boolean; debug: boolean }) {
  const repoTarget = classifyRepoTarget(input.repo);
  return {
    ...(repoTarget ? { repoTarget } : {}),
    debug: input.debug,
    outputMode: input.json ? ('json' as const) : ('human' as const),
  };
}

export function buildUsageText(): string {
  return usageText;
}

export function parseCliArgs(argv: string[]): ParsedCliResult {
  const { options, rest } = parseGlobalOptions(argv);

  if (rest.length === 0) {
    throw new Error(usageText.trim());
  }

  const [command, ...tail] = rest;
  const executionContext = toExecutionContext(options);

  if (command === 'index') {
    const repoPath = tail[0];
    return {
      command: {
        name: 'index',
        capability: 'IndexRepo',
        request: repoPath ? { repo: { repoPath } } : {},
        executionContext,
        renderResult: true,
      },
    };
  }

  if (command === 'explore') {
    const target = tail[0];

    if (!target) {
      throw new Error('gojo explore requires a <target>');
    }

    return {
      command: {
        name: 'explore',
        capability: 'ExploreComponent',
        request: {
          target,
          ...(classifyRepoTarget(options.repo)?.repoId ? { repo: { repoId: classifyRepoTarget(options.repo)?.repoId } } : {}),
        },
        executionContext,
        renderResult: true,
      },
    };
  }

  if (command === 'health') {
    return {
      command: {
        name: 'health',
        capability: 'RunHealthChecks',
        request: classifyRepoTarget(options.repo) ? { repo: classifyRepoTarget(options.repo) } : {},
        executionContext,
        renderResult: true,
      },
    };
  }

  if (command === 'mcp' && tail[0] === 'serve') {
    return {
      command: {
        name: 'mcp serve',
        capability: 'ServeMCP',
        request: {
          transport: 'stdio',
        },
        executionContext,
        renderResult: true,
      },
    };
  }

  throw new Error(`Unknown command: ${rest.join(' ')}\n\n${usageText.trim()}`);
}
