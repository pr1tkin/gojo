import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePackageRootFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GOJO_PACKAGE_ROOT?.trim()) {
    return path.resolve(env.GOJO_PACKAGE_ROOT.trim());
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDirectory, '../../..');
}
