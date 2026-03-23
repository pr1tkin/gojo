import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import {
  collectApiPropagationForSymbol,
  extractApiClientRouteCalls,
  getCanonicalApiRouteId,
} from '../../src/typescript/api-propagation.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-api-propagation-test-'));
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('api propagation', () => {
  it('recognizes next app router api route identities', () => {
    expect(getCanonicalApiRouteId('app/api/automations/route.ts')).toBe('/api/automations');
    expect(getCanonicalApiRouteId('app/api/contracts/[id]/route.ts')).toBe('/api/contracts/[id]');
    expect(getCanonicalApiRouteId('lib/services/automations.ts')).toBeNull();
  });

  it('extracts client fetch calls to api routes conservatively', () => {
    const source = [
      "const API_BASE_URL = '/api';",
      "export async function loadAutomations() {",
      '  await fetch(`${API_BASE_URL}/automations`);',
      '  await fetch(`${API_BASE_URL}/contracts/${id}`);',
      "  await fetch('/health');",
      '}',
    ].join('\n');

    expect(extractApiClientRouteCalls('src/hooks/useAutomations.ts', source)).toEqual([
      {
        routeId: '/api/automations',
        method: 'GET',
        line: 3,
        snippet: 'await fetch(`${API_BASE_URL}/automations`);',
      },
    ]);
  });

  it('derives route and client propagation edges for service symbols', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'api-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'services'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'hooks'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'app', 'api', 'automations'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
          allowJs: true,
          skipLibCheck: true,
        },
        include: ['**/*.ts', '**/*.tsx'],
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'services', 'automations.ts'),
      [
        'export async function getAutomations() {',
        '  return [];',
        '}',
        '',
        'export async function createAutomation() {',
        '  return { id: 1 };',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'app', 'api', 'automations', 'route.ts'),
      [
        "import { createAutomation, getAutomations } from '../../../lib/services/automations';",
        '',
        'export async function GET() {',
        '  return await getAutomations();',
        '}',
        '',
        'export async function POST() {',
        '  return await createAutomation();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'hooks', 'useAutomationsQuery.ts'),
      [
        'export async function useAutomationsQuery() {',
        "  return fetch('/api/automations');",
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'hooks', 'useAutomationsMutation.ts'),
      [
        'export async function useAutomationsMutation() {',
        "  return fetch('/api/automations', { method: 'POST' });",
        '}',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const target = index.byName.getAutomations[0];

    expect(target).toBeDefined();

    const result = await collectApiPropagationForSymbol(
      {
        id: 'api-repo',
        name: 'api-repo',
        rootPath: repositoryRoot,
        isGitRepository: true,
      },
      target,
      index.byFile,
    );

    expect(result.routeHandlers).toEqual([
      expect.objectContaining({
        kind: 'api_route_handler',
        routeId: '/api/automations',
        routeFilePath: 'app/api/automations/route.ts',
        handlerName: 'GET',
      }),
    ]);
    expect(result.clientCalls).toEqual([
      expect.objectContaining({
        kind: 'api_client_to_route',
        routeId: '/api/automations',
        clientFilePath: 'lib/hooks/useAutomationsQuery.ts',
        method: 'GET',
      }),
    ]);
    expect(result.propagatedClients).toEqual([
      expect.objectContaining({
        kind: 'api_propagation',
        routeId: '/api/automations',
        routeFilePath: 'app/api/automations/route.ts',
        clientFilePath: 'lib/hooks/useAutomationsQuery.ts',
        method: 'GET',
        handlerName: 'GET',
      }),
    ]);
    expect(result.propagatedClients).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientFilePath: 'lib/hooks/useAutomationsMutation.ts',
        }),
      ]),
    );
  });
});
