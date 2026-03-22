import path from 'node:path';

import { assembleReleaseArtifact } from './assemble-artifact.ts';
import {
  runCommand,
  stableStringify,
  type ReleaseAssemblyResult,
} from './shared.ts';
import { validateReleaseArtifact, writeReleaseArtifactReport } from './validate-artifact.ts';

export async function packageReleaseArtifact(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseAssemblyResult> {
  const assembly = await assembleReleaseArtifact(env);
  const rootEntries = ['gojo', 'helper', 'README.md', 'LICENSE', 'VERSION', '.runtime'];

  runCommand(
    'tar',
    [
      '--sort=name',
      '--mtime=UTC 1970-01-01',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      assembly.artifactPath,
      ...rootEntries,
    ],
    { cwd: assembly.artifactRoot },
  );

  return assembly;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  packageReleaseArtifact()
    .then(async (assembly) => {
      const validation = await validateReleaseArtifact(assembly.artifactPath, process.env);
      await writeReleaseArtifactReport(validation);
      process.stdout.write(
        stableStringify({
          artifactPath: path.resolve(assembly.artifactPath),
          reportPath: validation ? path.resolve('docs/release/release-artifact-report.md') : null,
          metadata: assembly.metadata,
        }),
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
