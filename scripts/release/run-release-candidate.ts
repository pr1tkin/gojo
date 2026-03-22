import path from 'node:path';

import { packageReleaseArtifact } from './package-artifact.ts';
import { validateReleaseArtifact, writeReleaseArtifactReport } from './validate-artifact.ts';
import { generateChecksums } from './generate-checksums.ts';
import { writeReleaseManifest } from './write-release-manifest.ts';
import { generateReleaseNotes } from './generate-release-notes.ts';
import {
  getMcpServerRoot,
  getReleaseArtifactPaths,
  runCommand,
  stableStringify,
} from './shared.ts';

function logStep(message: string): void {
  process.stdout.write(`[release-candidate] ${message}\n`);
}

export async function runReleaseCandidate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  artifactPath: string;
  checksumsPath: string;
  manifestPath: string;
  releaseNotesPath: string;
  artifactReportPath: string;
}> {
  logStep('building mcp-server');
  runCommand('npm', ['run', 'build'], {
    cwd: getMcpServerRoot(),
    env,
  });

  logStep('assembling and archiving release artifact');
  const assembly = await packageReleaseArtifact(env);
  const artifactPaths = getReleaseArtifactPaths(assembly.versionDirectory);
  if (artifactPaths.length === 0) {
    throw new Error(`No release artifacts were produced in ${assembly.versionDirectory}.`);
  }

  logStep('validating packaged artifact');
  const validation = await validateReleaseArtifact(assembly.artifactPath, env);
  const artifactReportPath = await writeReleaseArtifactReport(validation);

  logStep('generating checksums');
  const checksums = await generateChecksums(artifactPaths);

  logStep('writing release manifest');
  const manifest = await writeReleaseManifest(artifactPaths, checksums.outputPath);

  logStep('generating release notes');
  const notes = await generateReleaseNotes(manifest.outputPath);

  return {
    artifactPath: path.resolve(assembly.artifactPath),
    checksumsPath: path.resolve(checksums.outputPath),
    manifestPath: path.resolve(manifest.outputPath),
    releaseNotesPath: path.resolve(notes.outputPath),
    artifactReportPath: path.resolve(artifactReportPath),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReleaseCandidate()
    .then((result) => {
      process.stdout.write(stableStringify(result));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
