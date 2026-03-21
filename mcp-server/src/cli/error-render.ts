import type { CliStructuredError } from './types.js';

function renderSection(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }

  return [title, ...lines.map((line) => `  ${line}`)];
}

export function renderCliError(error: CliStructuredError): string {
  const lines: string[] = [
    error.error.title,
    error.error.reason,
  ];

  lines.push(...renderSection('How to fix', error.error.how_to_fix));
  lines.push(...renderSection('Suggested next step', error.error.suggested_commands));

  return `${lines.join('\n')}\n`;
}
