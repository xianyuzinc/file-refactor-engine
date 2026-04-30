import fs from 'node:fs/promises';
import path from 'node:path';
import { IndexedFile, ProjectIndex, SupportedFileType } from './types.js';
import { relFromAbs, shouldSkipDir, toPosixPath } from './pathUtils.js';
import { sha256File } from './hash.js';

const SUPPORTED_EXTENSIONS: Record<string, SupportedFileType> = {
  '.tex': 'tex',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.py': 'python',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.m': 'matlab',
  '.c': 'c-family',
  '.h': 'c-family',
  '.cc': 'c-family',
  '.hh': 'c-family',
  '.cpp': 'c-family',
  '.hpp': 'c-family',
  '.cxx': 'c-family',
  '.hxx': 'c-family',
  '.java': 'jvm',
  '.kt': 'jvm',
  '.kts': 'jvm',
  '.scala': 'jvm',
  '.go': 'go',
  '.rs': 'rust',
  '.cs': 'dotnet',
  '.fs': 'dotnet',
  '.fsx': 'dotnet',
  '.vb': 'dotnet',
  '.php': 'php',
  '.rb': 'ruby',
  '.lua': 'lua',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'shell',
  '.r': 'r',
  '.jl': 'julia',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.ipynb': 'ipynb',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.bib': 'bibtex',
};

const TEXT_EXTENSIONS = new Set([
  ...Object.keys(SUPPORTED_EXTENSIONS),
  '.txt',
  '.csv',
  '.tsv',
  '.ini',
  '.cfg',
]);

export function detectFileType(absPath: string): SupportedFileType {
  const ext = path.extname(absPath).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] ?? 'other';
}

export function isTextFile(absPath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

export async function scanProject(rootPath: string): Promise<ProjectIndex> {
  const root = path.resolve(rootPath);
  const files: IndexedFile[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(abs);
      const relPath = toPosixPath(relFromAbs(root, abs));
      files.push({
        relPath,
        absPath: abs,
        type: detectFileType(abs),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: await sha256File(abs),
        isText: isTextFile(abs),
      });
    }
  }

  await walk(root);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return {
    rootPath: root,
    files,
    filesByRel: Object.fromEntries(files.map((file) => [file.relPath, file])),
    generatedAt: new Date().toISOString(),
  };
}
