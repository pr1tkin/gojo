import type { RenderableRuntimeResponse } from './types.js';
import type { CliCommand } from './types.js';
import { deriveSuggestedCommands } from './experience.js';

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

export function renderRuntimeResponse(response: RenderableRuntimeResponse, command?: CliCommand): string {
  if (response.capability === 'GetProductVersion') {
    return `${response.summary.text}\n`;
  }

  const sections: string[] = [
    `${response.summary.title}\n${response.summary.text}`,
  ];

  const stateSection = renderSection('State', [
    `readiness: ${response.readiness_state}`,
    `trust: ${response.trust_level}`,
    `confidence: ${response.confidence}`,
  ]);
  if (stateSection.length > 0) {
    sections.push(stateSection.join('\n'));
  }

  const findingsSection = renderSection(
    'Findings',
    response.findings.map((finding) => {
      const severity = finding.severity ? `[${finding.severity}] ` : '';
      return `${severity}${finding.title}: ${finding.summary}`;
    }),
  );
  if (findingsSection.length > 0) {
    sections.push(findingsSection.join('\n'));
  }

  const warningsSection = renderSection(
    'Warnings',
    response.warnings.map((warning) => warning),
  );
  if (warningsSection.length > 0) {
    sections.push(warningsSection.join('\n'));
  }

  const relatedSection = renderSection(
    'Related',
    response.related_entities.map((entity) =>
      entity.path ? `${entity.kind}: ${entity.name} (${entity.path})` : `${entity.kind}: ${entity.name}`,
    ),
  );
  if (relatedSection.length > 0) {
    sections.push(relatedSection.join('\n'));
  }

  const signalsSection = renderSection(
    'Signals',
    response.signals.map((signal) => `${signal.name}: ${formatSignalValue(signal.value)}`),
  );
  if (signalsSection.length > 0) {
    sections.push(signalsSection.join('\n'));
  }

  if (command) {
    const nextStepsSection = renderSection('Next step', deriveSuggestedCommands(response, command));
    if (nextStepsSection.length > 0) {
      sections.push(nextStepsSection.join('\n'));
    }
  }

  return `${sections.join('\n\n')}\n`;
}
