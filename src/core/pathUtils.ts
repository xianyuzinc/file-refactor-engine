import path from 'node:path';

export const DEFAULT_EXCLUDES = new Set([
  '.git',
  '.filerefactor',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'dist',
  'build',
  'release',
]);

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function normalizeRel(value: string): string {
  const cleaned = toPosixPath(value.trim()).replace(/^\/+/, '');
  return path.posix.normalize(cleaned).replace(/^\.\//, '');
}

export function absFromRel(rootPath: string, relPath: string): string {
  return path.resolve(rootPath, normalizeRel(relPath));
}

export function relFromAbs(rootPath: string, absPath: string): string {
  return normalizeRel(path.relative(rootPath, absPath));
}

export function isInsideRoot(rootPath: string, candidateAbs: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidateAbs);
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertInsideRoot(rootPath: string, candidateAbs: string): void {
  if (!isInsideRoot(rootPath, candidateAbs)) {
    throw new Error(`Path escapes project root: ${candidateAbs}`);
  }
}

export function isUrlLike(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//');
}

export function isAnchorLike(value: string): boolean {
  return value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('data:');
}

export function hasGlobMagic(value: string): boolean {
  return /[*?\[\]{}]/.test(value);
}

export function dirnameRel(relPath: string): string {
  const dir = path.posix.dirname(normalizeRel(relPath));
  return dir === '.' ? '' : dir;
}

export function relativeReference(fromFileRel: string, toTargetRel: string, style: 'slash' | 'backslash' = 'slash'): string {
  const fromDir = dirnameRel(fromFileRel);
  let rel = path.posix.relative(fromDir || '.', normalizeRel(toTargetRel));
  if (!rel.startsWith('.') && !rel.startsWith('/')) {
    rel = rel || path.posix.basename(toTargetRel);
  }
  return style === 'backslash' ? rel.replace(/\//g, '\\') : rel;
}

export function mapRelThroughMoves(relPath: string, moves: Array<{ fromRel: string; toRel: string }>): string {
  const rel = normalizeRel(relPath);
  for (const move of moves) {
    const from = normalizeRel(move.fromRel);
    const to = normalizeRel(move.toRel);
    if (rel === from) return to;
    if (rel.startsWith(`${from}/`)) {
      return normalizeRel(`${to}/${rel.slice(from.length + 1)}`);
    }
  }
  return rel;
}

export function shouldSkipDir(dirName: string): boolean {
  return DEFAULT_EXCLUDES.has(dirName);
}
