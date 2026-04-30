import fs from 'node:fs/promises';
import path from 'node:path';
import { RollbackManifest, RollbackResult } from './types.js';
import { absFromRel } from './pathUtils.js';
import { sha256Text } from './hash.js';

export async function listRollbackManifests(rootPath: string): Promise<Array<{ id: string; path: string; appliedAt: string }>> {
  const historyDir = path.join(rootPath, '.filerefactor', 'history');
  try {
    const entries = await fs.readdir(historyDir, { withFileTypes: true });
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const manifestPath = path.join(historyDir, entry.name);
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as RollbackManifest;
        manifests.push({ id: manifest.id, path: manifestPath, appliedAt: manifest.appliedAt });
      } catch {
        // Ignore malformed history files.
      }
    }
    return manifests.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  } catch {
    return [];
  }
}

export async function rollbackFromManifestFile(manifestPath: string): Promise<RollbackResult> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as RollbackManifest;
  return rollbackManifest(manifest);
}

export async function rollbackManifest(manifest: RollbackManifest): Promise<RollbackResult> {
  const restoredFiles: string[] = [];
  const skippedFiles: string[] = [];
  const errors: string[] = [];

  for (const backup of manifest.textBackups) {
    const abs = absFromRel(manifest.rootPath, backup.relPathAfter);
    try {
      const current = await fs.readFile(abs, 'utf8');
      const currentHash = sha256Text(current);
      if (currentHash !== backup.afterHash) {
        skippedFiles.push(backup.relPathAfter);
        errors.push(`Skipped text restore because file changed after refactor: ${backup.relPathAfter}`);
        continue;
      }
      await fs.writeFile(abs, backup.beforeContent, 'utf8');
      restoredFiles.push(backup.relPathAfter);
    } catch (error) {
      skippedFiles.push(backup.relPathAfter);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const move of [...manifest.fileMoves].reverse()) {
    const fromAbs = absFromRel(manifest.rootPath, move.fromRel);
    const toAbs = absFromRel(manifest.rootPath, move.toRel);
    try {
      await fs.stat(fromAbs);
      skippedFiles.push(move.toRel);
      errors.push(`Cannot move back because original path already exists: ${move.fromRel}`);
      continue;
    } catch {
      // Original path missing is expected.
    }
    try {
      await fs.mkdir(path.dirname(fromAbs), { recursive: true });
      await fs.rename(toAbs, fromAbs);
      restoredFiles.push(move.toRel);
    } catch (error) {
      skippedFiles.push(move.toRel);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    ok: errors.length === 0,
    restoredFiles,
    skippedFiles,
    errors,
  };
}
