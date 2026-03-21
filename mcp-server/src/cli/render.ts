import type { RenderableRuntimeResponse } from './types.js';

function formatSignalValue(value: string | number | boolean | null): string {
  if (value === null) {
    return 'n/a';
  }

  return String(value);
}

function renderSection(title: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }

  return [title, ...lines.map((line) => `  ${line}`)];
}

export function renderRuntimeResponse(response: RenderableRuntimeResponse): string {
  const lines: string[] = [];

  lines.push(response.summary.title);
  lines.push(response.summary.text);

  lines.push(...renderSection(
    'Findings',
    response.findings.map((finding) => {
      const severity = finding.severity ? `[${finding.severity}] ` : '';
      return `${severity}${finding.title}: ${finding.summary}`;
    }),
  ));

  lines.push(...renderSection(
    'Warnings',
    response.warnings.map((warning) => warning),
  ));

  lines.push(...renderSection(
    'Related',
    response.related_entities.map((entity) =>
      entity.path ? `${entity.kind}: ${entity.name} (${entity.path})` : `${entity.kind}: ${entity.name}`,
    ),
  ));

  lines.push(...renderSection(
    'Signals',
    [
      `trust: ${response.trust}`,
      `confidence: ${response.confidence}`,
      ...response.signals.map((signal) => `${signal.name}: ${formatSignalValue(signal.value)}`),
    ],
  ));

  return `${lines.filter((line) => line.length > 0).join('\n')}\n`;
}
