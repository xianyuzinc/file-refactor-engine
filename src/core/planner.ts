import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import {
  FileMove,
  PlanWarning,
  ReferenceEdge,
  RefactorOperation,
  RefactorPlan,
  RenameOperation,
  TextEdit,
} from './types.js';
import { extractReferences } from './extractors.js';
import { scanProject } from './scanner.js';
import {
  absFromRel,
  assertInsideRoot,
  dirnameRel,
  isInsideRoot,
  mapRelThroughMoves,
  normalizeRel,
  relativeReference,
  toPosixPath,
} from './pathUtils.js';

export async function buildRefactorPlan(rootPath: string, operation: RefactorOperation): Promise<RefactorPlan> {
  const root = path.resolve(rootPath);
  const index = await scanProject(root);
  const references = await extractReferences(index);
  const warnings: PlanWarning[] = [];
  const fileMoves = await buildFileMoves(root, operation, warnings);
  const textEdits = await buildTextEdits(root, references, fileMoves, warnings);

  for (const reference of references) {
    if (reference.resolution !== 'resolved') {
      warnings.push({
        code:
          reference.resolution === 'external'
            ? 'external-reference'
            : reference.resolution === 'absolute'
              ? 'absolute-reference'
              : 'unresolved-reference',
        message: `${reference.raw} in ${reference.sourceRel}: ${reference.reason ?? reference.resolution}`,
        fileRel: reference.sourceRel,
        details: { referenceId: reference.id, raw: reference.raw },
      });
    }
  }

  const conflictCount = warnings.filter((warning) => warning.code === 'conflict' || warning.code === 'unsafe-path').length;
  return {
    id: `plan-${Date.now()}`,
    rootPath: root,
    operation,
    createdAt: new Date().toISOString(),
    canApply: fileMoves.length > 0 && conflictCount === 0,
    fileMoves,
    textEdits,
    references,
    warnings,
    affectedTextFiles: [...new Set(textEdits.map((edit) => edit.sourceRel))].sort(),
  };
}

async function buildFileMoves(rootPath: string, operation: RefactorOperation, warnings: PlanWarning[]): Promise<FileMove[]> {
  if (operation.type === 'move') {
    return buildMoveOperation(rootPath, operation.sourceRel, operation.destinationRel, warnings);
  }
  return buildRenameOperation(rootPath, operation, warnings);
}

async function buildMoveOperation(rootPath: string, sourceInput: string, destinationInput: string, warnings: PlanWarning[]): Promise<FileMove[]> {
  const sourceRel = normalizeRel(sourceInput);
  const destinationRel = normalizeRel(destinationInput);
  const sourceAbs = absFromRel(rootPath, sourceRel);
  const destinationAbs = absFromRel(rootPath, destinationRel);

  if (!isInsideRoot(rootPath, sourceAbs) || !isInsideRoot(rootPath, destinationAbs)) {
    warnings.push({ code: 'unsafe-path', message: 'Move source or destination escapes the project root.' });
    return [];
  }
  if (sourceRel === destinationRel) {
    warnings.push({ code: 'noop', message: 'Source and destination are identical.', fileRel: sourceRel });
    return [];
  }
  if (destinationRel.startsWith(`${sourceRel}/`)) {
    warnings.push({ code: 'conflict', message: 'A directory cannot be moved into itself.', fileRel: sourceRel });
    return [];
  }

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourceAbs);
  } catch {
    warnings.push({ code: 'conflict', message: `Source does not exist: ${sourceRel}`, fileRel: sourceRel });
    return [];
  }
  try {
    await fs.stat(destinationAbs);
    warnings.push({ code: 'conflict', message: `Destination already exists: ${destinationRel}`, fileRel: destinationRel });
    return [];
  } catch {
    // Destination does not exist, which is required.
  }

  return [
    {
      fromRel: sourceRel,
      toRel: destinationRel,
      kind: sourceStat.isDirectory() ? 'directory' : 'file',
    },
  ];
}

async function buildRenameOperation(rootPath: string, operation: RenameOperation, warnings: PlanWarning[]): Promise<FileMove[]> {
  const matches =
    operation.mode === 'glob'
      ? await fg(toPosixPath(operation.pattern), {
          cwd: rootPath,
          onlyFiles: true,
          dot: true,
          unique: true,
          ignore: ['**/.git/**', '**/.filerefactor/**', '**/node_modules/**', '**/.venv/**', '**/__pycache__/**'],
        })
      : await regexMatches(rootPath, operation.pattern);

  const fileMoves: FileMove[] = [];
  const destinations = new Set<string>();
  const globRegex = operation.mode === 'glob' ? globToRegex(toPosixPath(operation.pattern)) : undefined;

  matches.sort((a, b) => a.localeCompare(b));
  for (const [index, relRaw] of matches.entries()) {
    const rel = normalizeRel(relRaw);
    const parsed = path.posix.parse(rel);
    const captures = operation.mode === 'glob' && globRegex ? rel.match(globRegex) : rel.match(new RegExp(operation.pattern));
    const newName = renderRenameTemplate(operation.template, {
      index: index + 1,
      stem: parsed.name,
      ext: parsed.ext,
      captures: captures ? captures.slice(1) : [],
      groups: captures?.groups ?? {},
    });
    const toRel = normalizeRel(path.posix.join(parsed.dir, newName));
    if (rel === toRel) {
      warnings.push({ code: 'noop', message: `Rename leaves file unchanged: ${rel}`, fileRel: rel });
      continue;
    }
    if (destinations.has(toRel)) {
      warnings.push({ code: 'conflict', message: `Multiple files would rename to ${toRel}`, fileRel: rel });
      continue;
    }
    destinations.add(toRel);
    const absTo = absFromRel(rootPath, toRel);
    assertInsideRoot(rootPath, absTo);
    try {
      await fs.stat(absTo);
      warnings.push({ code: 'conflict', message: `Destination already exists: ${toRel}`, fileRel: toRel });
      continue;
    } catch {
      fileMoves.push({ fromRel: rel, toRel, kind: 'file' });
    }
  }

  if (matches.length === 0) {
    warnings.push({ code: 'noop', message: 'Rename pattern matched no files.' });
  }
  return fileMoves;
}

async function regexMatches(rootPath: string, pattern: string): Promise<string[]> {
  const regex = new RegExp(pattern);
  const all = await fg('**/*', {
    cwd: rootPath,
    onlyFiles: true,
    dot: true,
    unique: true,
    ignore: ['**/.git/**', '**/.filerefactor/**', '**/node_modules/**', '**/.venv/**', '**/__pycache__/**'],
  });
  return all.filter((rel) => regex.test(toPosixPath(rel)));
}

function globToRegex(pattern: string): RegExp {
  let source = '^';
  for (const ch of pattern) {
    if (ch === '*') source += '([^/]*)';
    else if (ch === '?') source += '([^/])';
    else source += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source);
}

function renderRenameTemplate(
  template: string,
  context: { index: number; stem: string; ext: string; captures: string[]; groups: Record<string, string> },
): string {
  return template.replace(/\{([^}]+)}/g, (_, token: string) => {
    if (token === 'index') return String(context.index);
    if (token === 'stem') return context.stem;
    if (token === 'ext' || token === 'extname') return context.ext;
    if (/^\d+$/.test(token)) return context.captures[Number(token) - 1] ?? '';
    return context.groups[token] ?? '';
  });
}

async function buildTextEdits(rootPath: string, references: ReferenceEdge[], fileMoves: FileMove[], warnings: PlanWarning[]): Promise<TextEdit[]> {
  const edits: TextEdit[] = [];
  const contentByFile = new Map<string, string>();
  const simplifiedMoves = fileMoves.map((move) => ({ fromRel: move.fromRel, toRel: move.toRel }));

  for (const reference of references) {
    if (reference.resolution !== 'resolved' || !reference.resolvedTargetRel) continue;
    const newSourceRel = mapRelThroughMoves(reference.sourceRel, simplifiedMoves);
    const newTargetRel = mapRelThroughMoves(reference.resolvedTargetRel, simplifiedMoves);
    if (newSourceRel === reference.sourceRel && newTargetRel === reference.resolvedTargetRel) continue;

    const sourceAbs = absFromRel(rootPath, reference.sourceRel);
    let text = contentByFile.get(reference.sourceRel);
    if (text === undefined) {
      text = await fs.readFile(sourceAbs, 'utf8');
      contentByFile.set(reference.sourceRel, text);
    }

    const oldText = text.slice(reference.start, reference.end);
    let newReference = relativeReference(newSourceRel, newTargetRel, 'slash');
    if (reference.preserveExtensionless) {
      const ext = path.posix.extname(newReference);
      if (ext) newReference = newReference.slice(0, -ext.length);
    }
    if (oldText === newReference) continue;

    edits.push({
      sourceRel: reference.sourceRel,
      start: reference.start,
      end: reference.end,
      oldText,
      newText: newReference,
      referenceId: reference.id,
      resolvedTargetRel: reference.resolvedTargetRel,
    });
  }

  const overlaps = findOverlappingEdits(edits);
  for (const overlap of overlaps) {
    warnings.push({
      code: 'conflict',
      message: `Overlapping text edits in ${overlap}`,
      fileRel: overlap,
    });
  }

  return edits.sort((a, b) => a.sourceRel.localeCompare(b.sourceRel) || a.start - b.start);
}

function findOverlappingEdits(edits: TextEdit[]): string[] {
  const byFile = new Map<string, TextEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.sourceRel) ?? [];
    list.push(edit);
    byFile.set(edit.sourceRel, list);
  }

  const overlaps: string[] = [];
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end) {
        overlaps.push(file);
        break;
      }
    }
  }
  return overlaps;
}
