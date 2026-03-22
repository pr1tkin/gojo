import path from 'node:path';

const originalChdir = process.chdir.bind(process);

function syncTestProductHome(): void {
  const root = path.join(process.cwd(), 'gojo');
  process.env.GOJO_HOME = root;
  process.env.GOJO_CONFIG_DIR = path.join(root, 'config');
  process.env.GOJO_DATA_DIR = path.join(root, 'data');
  process.env.GOJO_INDEXES_DIR = path.join(root, 'data', 'indexes');
  process.env.GOJO_CACHE_DIR = path.join(root, 'cache');
  process.env.GOJO_LOG_DIR = path.join(root, 'logs');
  process.env.GOJO_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.GOJO_TEMP_DIR = path.join(root, 'runtime', 'tmp');
}

process.chdir = ((directory: string) => {
  originalChdir(directory);
  syncTestProductHome();
}) as typeof process.chdir;

syncTestProductHome();
