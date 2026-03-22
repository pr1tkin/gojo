export interface ReleaseArtifactContract {
  archiveNamePattern: string;
  rootDirectory: string;
  helperDirectory: string;
  readmeFile: string;
  licenseFile: string;
  versionFile: string;
  topLevelEntries: string[];
}

export const RELEASE_ARTIFACT_CONTRACT: ReleaseArtifactContract = {
  archiveNamePattern: 'gojo-{version}-{platform}-{arch}.tar.gz',
  rootDirectory: 'gojo',
  helperDirectory: 'helper',
  readmeFile: 'README.md',
  licenseFile: 'LICENSE',
  versionFile: 'VERSION',
  topLevelEntries: ['gojo', 'helper/', 'README.md', 'LICENSE', 'VERSION'],
};

export function getReleaseArtifactName(version: string, platform: string, arch: string): string {
  return `gojo-${version}-${platform}-${arch}.tar.gz`;
}
