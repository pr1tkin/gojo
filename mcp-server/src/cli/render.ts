import type { RenderableRuntimeResponse } from './types.js';
import type { CliCommand } from './types.js';
import { deriveSuggestedCommands } from './experience.js';

interface BucketedEntry {
  filePath?: string;
  symbolName?: string;
}

interface BucketedSection {
  label?: string;
  explanation?: string;
  entries?: BucketedEntry[];
  total?: number;
  shown?: number;
  truncated?: boolean;
}

interface BucketedMachinePayload {
  direct_consumers?: BucketedSection;
  indirect_consumers?: BucketedSection;
  related_context?: BucketedSection;
}

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

function getBucketedPayload(response: RenderableRuntimeResponse): BucketedMachinePayload | null {
  const payload = response.machine_payload as BucketedMachinePayload | null | undefined;

  if (!payload) {
    return null;
  }

  if (!payload.direct_consumers && !payload.indirect_consumers && !payload.related_context) {
    return null;
  }

  return payload;
}

function renderBucketEntries(section: BucketedSection | undefined, emptyText: string): string[] {
  const entries = section?.entries ?? [];
  const lines: string[] = [];

  if (entries.length === 0) {
    lines.push(emptyText);
  } else {
    lines.push(
      ...entries.map((entry) => {
        if (entry.symbolName) {
          return `${entry.filePath}#${entry.symbolName}`;
        }

        return entry.filePath ?? '(unknown)';
      }),
    );
  }

  if (section?.truncated && section.total !== undefined) {
    lines.push(`showing ${section.shown ?? entries.length} of ${section.total}`);
  }

  return lines;
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
    `kind: ${response.result_kind}`,
    `coverage: ${response.coverage}`,
    ...(response.coverage_signals.length > 0 ? [`coverage signals: ${response.coverage_signals.join(', ')}`] : []),
    ...(response.evidence_types.length > 0 ? [`evidence: ${response.evidence_types.join(', ')}`] : []),
    ...(response.note ? [`note: ${response.note}`] : []),
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

  const bucketedPayload = getBucketedPayload(response);

  if (bucketedPayload) {
    const directSection = renderSection(
      bucketedPayload.direct_consumers?.label ?? 'Direct consumers (exact)',
      [
        bucketedPayload.direct_consumers?.explanation ?? 'confirmed symbol-level usage',
        ...renderBucketEntries(bucketedPayload.direct_consumers, '(none found)'),
      ],
    );
    const indirectSection = renderSection(
      bucketedPayload.indirect_consumers?.label ?? 'Indirect consumers (inferred)',
      [
        bucketedPayload.indirect_consumers?.explanation ?? 'likely usage via wrappers or re-exports',
        ...renderBucketEntries(bucketedPayload.indirect_consumers, '(none found)'),
      ],
    );
    const relatedSection = renderSection(
      bucketedPayload.related_context?.label ?? 'Related context (exploratory)',
      [
        bucketedPayload.related_context?.explanation ?? 'nearby or related files, not guaranteed direct usage',
        ...renderBucketEntries(bucketedPayload.related_context, '(none found)'),
      ],
    );

    const directCount = bucketedPayload.direct_consumers?.entries?.length ?? 0;
    const indirectCount = bucketedPayload.indirect_consumers?.entries?.length ?? 0;
    const relatedCount = bucketedPayload.related_context?.entries?.length ?? 0;

    if (directCount === 0 && indirectCount === 0 && relatedCount > 0) {
      sections.push('No direct or inferred consumers found.\nShowing related context only.');
    }

    if (directSection.length > 0) {
      sections.push(directSection.join('\n'));
    }

    if (indirectSection.length > 0) {
      sections.push(indirectSection.join('\n'));
    }

    if (relatedSection.length > 0) {
      sections.push(relatedSection.join('\n'));
    }
  }

  if (command) {
    const nextStepsSection = renderSection('Next step', deriveSuggestedCommands(response, command));
    if (nextStepsSection.length > 0) {
      sections.push(nextStepsSection.join('\n'));
    }
  }

  return `${sections.join('\n\n')}\n`;
}
