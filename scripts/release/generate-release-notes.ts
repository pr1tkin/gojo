import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { ReleaseManifest } from './write-release-manifest.ts';
import {
  getReleaseNotesPath,
  stableStringify,
} from './shared.ts';

function loadManifest(manifestPath: string): ReleaseManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
}

export async function generateReleaseNotes(
  manifestPath: string,
  outputPath?: string,
): Promise<{ outputPath: string; notes: string }> {
  const manifest = loadManifest(manifestPath);
  const supportedPlatforms = Array.from(
    new Set(manifest.artifacts.map((artifact) => `${artifact.platform}/${artifact.arch}`)),
  ).sort();
  const assetList = manifest.artifacts
    .map((artifact) => `- \`${artifact.filename}\` (${artifact.platform}/${artifact.arch}, ${artifact.size} bytes)`)
    .join('\n');
  const helperNote =
    manifest.helperPackaging === 'bundled'
      ? `Bundled search helpers: ${manifest.helperFilenames.map((entry) => `\`${entry}\``).join(', ')}.`
      : 'Search helpers are not bundled in this release.';
  const notes = `# Gojo ${manifest.version}

Gojo ${manifest.version} packages the current CLI, packaged runtime payload, and bundled search helpers for validated release use.

## Included assets

${assetList}

## Supported platforms

${supportedPlatforms.map((platform) => `- ${platform}`).join('\n')}

## Install / extract

1. Download the archive for your platform.
2. Extract it with \`tar -xzf <archive>\`.
3. Run \`./gojo version\` to verify the packaged runtime.

## Checksums

SHA-256 checksums are provided in \`checksums.txt\`. Verify the downloaded archive before use.

## Runtime / helper notes

- The current packaged launcher expects a Node.js runtime on the target machine.
- ${helperNote}

## Known limitations

- This release keeps the current Node-oriented packaged runtime model.
- Rich changelog automation and signed release assets are not part of this release slice yet.
`;

  const targetOutputPath =
    outputPath ?? getReleaseNotesPath(path.dirname(path.resolve(manifestPath)));
  await fsp.mkdir(path.dirname(targetOutputPath), { recursive: true });
  await fsp.writeFile(targetOutputPath, `${notes}\n`, 'utf8');

  return {
    outputPath: targetOutputPath,
    notes,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    process.stderr.write('Usage: generate-release-notes.ts <manifest-path>\n');
    process.exitCode = 1;
  } else {
    generateReleaseNotes(manifestPath)
      .then((result) => {
        process.stdout.write(stableStringify({ outputPath: result.outputPath }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      });
  }
}
