#!/usr/bin/env node

import { loadConfig } from './config.js';
import { stderrLogger } from './logging.js';
import { RuntimeHost } from './runtime/index.js';
import { parseCliArgs } from './cli/parse.js';
import { renderRuntimeResponse } from './cli/render.js';
import { buildCliStructuredError, getCliExitCode } from './cli/experience.js';
import { renderCliError } from './cli/error-render.js';
import { startMcpServer } from './server.js';
import type { ParsedCliResult } from './cli/types.js';

async function runCli(parsed: ParsedCliResult): Promise<number> {
  const config = loadConfig();
  const runtime = new RuntimeHost({
    config,
    logger: stderrLogger,
    startMcpServer,
  });

  const response = await runtime.execute(
    parsed.command.capability,
    parsed.command.request as never,
    parsed.command.executionContext,
  );

  if (parsed.command.executionContext.outputMode === 'json') {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } else if (parsed.command.renderResult) {
    process.stdout.write(renderRuntimeResponse(response, parsed.command));
  }

  if (response.executionMode === 'long_running') {
    process.stdin.resume();
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
      process.stdin.once('end', () => resolve());
      process.stdin.once('close', () => resolve());
    });
  }

  return 0;
}

let parsedCommand: ParsedCliResult | undefined;
const requestedJsonOutput = process.argv.slice(2).includes('--json');

(async () => {
  try {
    parsedCommand = parseCliArgs(process.argv.slice(2));
    process.exitCode = await runCli(parsedCommand);
  } catch (error: unknown) {
    const structuredError = buildCliStructuredError(error, parsedCommand?.command);

    if (parsedCommand?.command.executionContext.outputMode === 'json' || requestedJsonOutput) {
      process.stdout.write(`${JSON.stringify(structuredError, null, 2)}\n`);
    } else {
      process.stderr.write(renderCliError(structuredError));
    }

    process.exitCode = getCliExitCode(error);
  }
})();
