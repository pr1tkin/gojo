import { describe, expect, it, vi } from 'vitest';

import { getToolRegistrations, getVisibleToolRegistrations, registerGojoTools } from '../../src/tool-registry.js';

describe('tool registry visibility enforcement', () => {
  it('marks all tools with explicit visibility metadata', () => {
    const registrations = getToolRegistrations();

    expect(registrations).toHaveLength(13);
    expect(registrations.every((entry) => entry.definition.visibility === 'public' || entry.definition.visibility === 'internal')).toBe(true);
  });

  it('returns only public tools by default', () => {
    const registrations = getVisibleToolRegistrations(false);

    expect(registrations.map((entry) => entry.definition.name)).toEqual([
      'build_change_context',
      'explore_component',
      'find_precedents',
      'collect_refactor_context',
      'plan_change',
    ]);
  });

  it('returns the full tool list when internal exposure is enabled', () => {
    const registrations = getVisibleToolRegistrations(true);

    expect(registrations.map((entry) => entry.definition.name)).toEqual([
      'build_change_context',
      'explore_component',
      'find_precedents',
      'collect_refactor_context',
      'plan_change',
      'search_code',
      'open_file',
      'list_symbols',
      'find_symbol',
      'find_references',
      'find_related_files',
      'analyze_symbol',
      'search_patterns',
    ]);
  });

  it('registers only public tools by default and prefixes metadata accordingly', () => {
    const registerTool = vi.fn();
    const server = { registerTool } as any;

    registerGojoTools(server, {
      nodeEnv: 'test',
      port: 3000,
      reposRoot: '/repos',
      zoektBaseUrl: 'http://zoekt:6070',
      includeInternalTools: false,
    });

    expect(registerTool).toHaveBeenCalledTimes(5);
    const entries = registerTool.mock.calls.map((call) => ({
      name: call[0],
      description: call[1].description,
      meta: call[1]._meta,
    }));
    expect(entries.find((entry) => entry.name === 'build_change_context')).toEqual(
      expect.objectContaining({
        description: expect.stringContaining('Recommended entry point.'),
        meta: expect.objectContaining({
          visibility: 'public',
          role: 'primary',
          recommendedEntryPoint: true,
        }),
      }),
    );
    for (const name of ['explore_component', 'find_precedents', 'collect_refactor_context', 'plan_change']) {
      expect(entries.find((entry) => entry.name === name)).toEqual(
        expect.objectContaining({
          description: expect.stringContaining('Specialist tool.'),
          meta: expect.objectContaining({
            visibility: 'public',
            role: 'specialist',
            recommendedEntryPoint: false,
          }),
        }),
      );
    }
  });

  it('registers internal tools only when explicitly enabled', () => {
    const registerTool = vi.fn();
    const server = { registerTool } as any;

    registerGojoTools(
      server,
      {
        nodeEnv: 'test',
        port: 3000,
        reposRoot: '/repos',
        zoektBaseUrl: 'http://zoekt:6070',
        includeInternalTools: false,
      },
      { includeInternalTools: true },
    );

    const names = registerTool.mock.calls.map((call) => call[0]);
    expect(names).toContain('search_code');
    expect(names).toContain('search_patterns');
    const internalConfig = registerTool.mock.calls.find((call) => call[0] === 'search_code')?.[1];
    expect(internalConfig.description).toContain('[INTERNAL] Not intended for direct agent use');
    expect(internalConfig._meta).toEqual(
      expect.objectContaining({
        visibility: 'internal',
        role: 'internal',
        internal: true,
        recommendedEntryPoint: false,
      }),
    );
  });
});
