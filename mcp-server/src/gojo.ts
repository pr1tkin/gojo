#!/usr/bin/env node

import { loadConfig } from './config.js';
import { silentLogger, stderrLogger } from './logging.js';
import { RuntimeHost } from './runtime/index.js';
import { parseCliArgs } from './cli/parse.js';
import { renderRuntimeResponse } from './cli/render.js';
import { buildCliStructuredError, getCliExitCode } from './cli/experience.js';
import { renderCliError } from './cli/error-render.js';
import { finalizeCliCommand } from './cli/repo-target.js';
import type { ParsedCliResult } from './cli/types.js';

async function runCli(parsed: ParsedCliResult): Promise<number> {
  if (!parsed.command) {
    process.stdout.write(parsed.helpText ?? '');
    return 0;
  }

  const config = loadConfig();
  const finalizedCommand = await finalizeCliCommand(parsed.command, {
    config,
    cwd: process.cwd(),
  });
  parsed.command = finalizedCommand;
  const runtime = new RuntimeHost({
    config,
    logger: finalizedCommand.executionContext.debug ? stderrLogger : silentLogger,
  });

  const response = await runtime.execute(
    finalizedCommand.capability,
    finalizedCommand.request as never,
    finalizedCommand.executionContext,
  );

  if (finalizedCommand.executionContext.outputMode === 'json') {
    const payload =
      finalizedCommand.capability === 'GetProductVersion' ||
      finalizedCommand.capability === 'PlanChange' ||
      finalizedCommand.capability === 'BuildChangeContext'
        ? response.machine_payload
        : response;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (finalizedCommand.renderResult) {
    process.stdout.write(renderRuntimeResponse(response, finalizedCommand));
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

    if (parsedCommand?.command?.executionContext.outputMode === 'json' || requestedJsonOutput) {
      process.stdout.write(`${JSON.stringify(structuredError, null, 2)}\n`);
    } else {
      process.stderr.write(renderCliError(structuredError));
    }

    process.exitCode = getCliExitCode(error);
  }
})();
