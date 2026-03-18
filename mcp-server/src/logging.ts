export interface Logger {
  info: (message?: unknown, ...optionalParams: unknown[]) => void;
  warn: (message?: unknown, ...optionalParams: unknown[]) => void;
  error: (message?: unknown, ...optionalParams: unknown[]) => void;
}

function writeToStderr(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const rendered = args
    .map((value) => {
      if (value instanceof Error) {
        return value.stack ?? value.message;
      }

      return typeof value === 'string' ? value : String(value);
    })
    .join(' ');

  process.stderr.write(`[${level}] ${rendered}\n`);
}

export const stderrLogger: Logger = {
  info: (message?: unknown, ...optionalParams: unknown[]) =>
    writeToStderr('info', [message, ...optionalParams]),
  warn: (message?: unknown, ...optionalParams: unknown[]) =>
    writeToStderr('warn', [message, ...optionalParams]),
  error: (message?: unknown, ...optionalParams: unknown[]) =>
    writeToStderr('error', [message, ...optionalParams]),
};
