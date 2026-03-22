import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { BuildMetadata } from '../../mcp-server/src/types.ts';
import {
  getRepoRoot,
  getTempExtractionDirectory,
  loadVersionSnapshot,
  runCommand,
  stableStringify,
  type ReleaseValidationResult,
  type VersionSnapshot,
} from './shared.ts';

function assertJsonVersionShape(payload: Record<string, unknown>): void {
  const helper = payload.helper;
  if (typeof payload.product !== 'string') {
    throw new Error('Version JSON is invalid: product is missing.');
  }

  if (typeof payload.version !== 'string') {
    throw new Error('Version JSON is invalid: version is missing.');
  }

  if (typeof payload.git_sha !== 'string') {
    throw new Error('Version JSON is invalid: git_sha is missing.');
  }

  if (typeof payload.build_timestamp !== 'string') {
    throw new Error('Version JSON is invalid: build_timestamp is missing.');
  }

  if (typeof payload.platform !== 'string' || typeof payload.arch !== 'string') {
    throw new Error('Version JSON is invalid: platform/arch are missing.');
  }

  if (typeof payload.packaging_mode !== 'string') {
    throw new Error('Version JSON is invalid: packaging_mode is missing.');
  }

  if (typeof payload.is_dev !== 'boolean') {
    throw new Error('Version JSON is invalid: is_dev is missing.');
  }

  if (
    !helper ||
    typeof helper !== 'object' ||
    typeof (helper as Record<string, unknown>).mode !== 'string' ||
    !Array.isArray((helper as Record<string, unknown>).paths) ||
    typeof (helper as Record<string, unknown>).detected !== 'boolean'
  ) {
    throw new Error('Version JSON is invalid: helper metadata is incomplete.');
  }
}

function validateVersionPayload(payload: Record<string, unknown>, metadata: VersionSnapshot): void {
  assertJsonVersionShape(payload);

  if (payload.product !== metadata.productName) {
    throw new Error(`Version JSON product mismatch: expected ${metadata.productName}.`);
  }

  if (payload.version !== metadata.version) {
    throw new Error(`Version JSON version mismatch: expected ${metadata.version}.`);
  }

  if (payload.git_sha !== metadata.gitSha) {
    throw new Error(`Version JSON git_sha mismatch: expected ${metadata.gitSha}.`);
  }

  if (payload.build_timestamp !== metadata.buildTimestamp) {
    throw new Error(`Version JSON build_timestamp mismatch: expected ${metadata.buildTimestamp}.`);
  }

  if (payload.platform !== metadata.platform || payload.arch !== metadata.arch) {
    throw new Error('Version JSON platform/arch mismatch.');
  }

  if (payload.packaging_mode !== metadata.packagingMode) {
    throw new Error(`Version JSON packaging_mode mismatch: expected ${metadata.packagingMode}.`);
  }

  const helper = payload.helper as { mode: string; paths: unknown[]; detected: boolean };
  if (helper.mode !== metadata.helperPackaging) {
    throw new Error(`Version JSON helper mode mismatch: expected ${metadata.helperPackaging}.`);
  }

  if (helper.detected !== true) {
    throw new Error('Version JSON helper detection mismatch: expected true for bundled helpers.');
  }
}

export async function validateReleaseArtifact(
  artifactPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseValidationResult> {
  const extractionDirectory = getTempExtractionDirectory();
  const artifactSizeBytes = fs.statSync(artifactPath).size;
  const observations: string[] = [];

  try {
    runCommand('tar', ['-xzf', artifactPath, '-C', extractionDirectory]);

    const topLevelEntries = fs.readdirSync(extractionDirectory).sort();
    const requiredEntries = ['.runtime', 'LICENSE', 'README.md', 'VERSION', 'gojo', 'helper'];
    const structure = requiredEntries.every((entry) => topLevelEntries.includes(entry));
    if (!structure) {
      throw new Error(
        `Artifact structure is invalid: expected ${requiredEntries.join(', ')} at archive root.`,
      );
    }

    const versionFilePath = path.join(extractionDirectory, 'VERSION');
    const versionSnapshot = loadVersionSnapshot(versionFilePath);

    const commandEnv = {
      ...env,
      GOJO_HOME: path.join(extractionDirectory, '.gojo-home'),
    };

    const versionCommand = runCommand('./gojo', ['version'], {
      cwd: extractionDirectory,
      env: commandEnv,
    });
    const versionJsonCommand = runCommand('./gojo', ['version', '--json'], {
      cwd: extractionDirectory,
      env: commandEnv,
    });
    const helpCommand = runCommand('./gojo', ['--help'], {
      cwd: extractionDirectory,
      env: commandEnv,
    });

    if (!versionCommand.stdout.includes(versionSnapshot.version)) {
      throw new Error(`Version command output did not include ${versionSnapshot.version}.`);
    }

    const versionPayload = JSON.parse(versionJsonCommand.stdout) as Record<string, unknown>;
    validateVersionPayload(versionPayload, versionSnapshot);

    const helper = versionPayload.helper as { mode: string; paths: string[]; detected: boolean };
    const metadata: BuildMetadata = {
      productName: String(versionPayload.product),
      version: String(versionPayload.version),
      gitSha: String(versionPayload.git_sha),
      buildTimestamp: String(versionPayload.build_timestamp),
      platform: versionPayload.platform as BuildMetadata['platform'],
      arch: versionPayload.arch as BuildMetadata['arch'],
      packagingMode: versionPayload.packaging_mode as BuildMetadata['packagingMode'],
      helperPackaging: helper.mode as BuildMetadata['helperPackaging'],
      helperPaths: helper.paths,
      isDev: Boolean(versionPayload.is_dev),
    };

    const helperPaths = helper.paths;
    const helperNames = helperPaths.map((helperPath) => path.basename(helperPath)).sort();
    const expectedHelperNames = ['zoekt-git-index', 'zoekt-webserver'];
    const helperDetection =
      helperNames.length === expectedHelperNames.length &&
      expectedHelperNames.every((name, index) => helperNames[index] === name);
    if (!helperDetection) {
      throw new Error('Bundled helper detection did not resolve the expected helper files.');
    }

    const helperFiles = fs
      .readdirSync(path.join(extractionDirectory, 'helper'))
      .sort()
      .filter((entry) => entry !== 'manifest.json');

    observations.push(
      `Artifact validated from extracted root ${extractionDirectory}.`,
      `Wrapper launcher depends on an available Node.js runtime on the target machine.`,
    );

    return {
      metadata,
      artifactName: path.basename(artifactPath),
      artifactPath,
      artifactSizeBytes,
      extractedRoot: extractionDirectory,
      helperFiles,
      contents: topLevelEntries,
      validation: {
        structure: structure,
        versionCommand: versionCommand.status === 0,
        jsonOutput: versionJsonCommand.status === 0,
        helpCommand: helpCommand.status === 0,
        helperDetection,
      },
      observations,
    };
  } catch (error) {
    await fsp.rm(extractionDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function writeReleaseArtifactReport(result: ReleaseValidationResult): Promise<string> {
  const reportPath = path.join(getRepoRoot(), 'docs', 'release', 'release-artifact-report.md');
  const report = `# Gojo Release Artifact Report

## 1. Build Metadata

\`\`\`json
${JSON.stringify(result.metadata, null, 2)}
\`\`\`

## 2. Artifact Details

* artifact name: \`${result.artifactName}\`
* size: \`${result.artifactSizeBytes}\` bytes
* platform: \`${result.metadata.platform}\`
* arch: \`${result.metadata.arch}\`
* packaging mode: \`${result.metadata.packagingMode}\`

## 3. Contents

* gojo binary: \`gojo\`
* helper files: ${result.helperFiles.map((file) => `\`${file}\``).join(', ')}
* VERSION file: \`VERSION\`
* README / LICENSE: \`README.md\`, \`LICENSE\`

## 4. Validation Results

* version command: ${result.validation.versionCommand ? 'pass' : 'fail'}
* JSON output: ${result.validation.jsonOutput ? 'pass' : 'fail'}
* helper detection: ${result.validation.helperDetection ? 'pass' : 'fail'}
* structure validation: ${result.validation.structure ? 'pass' : 'fail'}
* help command: ${result.validation.helpCommand ? 'pass' : 'fail'}

## 5. Observations

${result.observations.map((entry) => `* ${entry}`).join('\n')}

## 6. Verdict

* ${Object.values(result.validation).every(Boolean) ? 'success' : 'failure'}
* ${Object.values(result.validation).every(Boolean) ? 'ready for release pipeline' : 'not ready for release pipeline'}
`;

  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  await fsp.writeFile(reportPath, report, 'utf8');
  return reportPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactPath = process.argv[2];
  if (!artifactPath) {
    process.stderr.write('Usage: validate-artifact.ts <artifact-path>\n');
    process.exitCode = 1;
  } else {
    validateReleaseArtifact(path.resolve(artifactPath))
      .then(async (result) => {
        const reportPath = await writeReleaseArtifactReport(result);
        process.stdout.write(
          stableStringify({
            reportPath,
            validation: result.validation,
          }),
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      });
  }
}
