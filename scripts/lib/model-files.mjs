import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const requiredFiles = [
  'pyproject.toml', 'config/project.yaml', 'config/manifest.schema.json',
  'deploy/demo-inputs/manifest.json', 'deploy/demo-inputs/inputs.zip',
  'db/seeds/scene/scene_manifest.json',
  'requirements-solver.txt', 'requirements-solver-lock.txt',
];

export async function modelFiles(root) {
  const files = [...requiredFiles];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '__pycache__') await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.py')) files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  await walk(join(root, 'src'));
  return files.sort();
}
