#!/usr/bin/env node

import { loadConfig } from './config.js';
import { stderrLogger } from './logging.js';
import { RuntimeHost } from './runtime/index.js';
import { parseCliArgs } from './cli/parse.js';
import { renderRuntimeResponse } from './cli/render.js';
import { startMcpServer } from './server.js';

function isUsageError(error: unknown): boolean {
  return error instanceof Error && (error.message.startsWith('Usage:') || error.message.includes('Unknown command') || error.message.includes('requires a <target>') || error.message.includes('Missing value for --repo'));
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);
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
    process.stdout.write(renderRuntimeResponse(response));
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

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = isUsageError(error) ? 2 : 1;
  },
);
