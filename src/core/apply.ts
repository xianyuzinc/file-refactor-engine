import fs from 'node:fs/promises';
import path from 'node:path';
import { ApplyResult, RefactorPlan, RollbackManifest, TextEdit, TextFileBackup } from './types.js';
import { absFromRel, mapRelThroughMoves } from './pathUtils.js';
import { sha256Text } from './hash.js';

export async function applyRefactorPlan(plan: RefactorPlan): Promise<ApplyResult> {
  const errors: string[] = [];
  if (!plan.canApply) {
    return { ok: false, errors: ['Plan has conflicts or no file operations.'] };
  }

  const groupedEdits = groupEdits(plan.textEdits);
  const simplifiedMoves = plan.fileMoves.map((move) => ({ fromRel: move.fromRel, toRel: move.toRel }));
  const backups: TextFileBackup[] = [];
  const afterContentByRel = new Map<string, string>();

  try {
    for (const [relPath, edits] of groupedEdits) {
      const abs = absFromRel(plan.rootPath, relPath);
      const beforeContent = await fs.readFile(abs, 'utf8');
      const afterContent = applyTextEdits(beforeContent, edits);
      backups.push({
        relPathBefore: relPath,
        relPathAfter: mapRelThroughMoves(relPath, simplifiedMoves),
        beforeHash: sha256Text(beforeContent),
        afterHash: sha256Text(afterContent),
        beforeContent,
      });
      afterContentByRel.set(relPath, afterContent);
    }

    const manifest: RollbackManifest = {
      id: `rollback-${Date.now()}`,
      rootPath: plan.rootPath,
      appliedAt: new Date().toISOString(),
      operation: plan.operation,
      fileMoves: plan.fileMoves,
      textBackups: backups,
      planSummary: {
        fileMoveCount: plan.fileMoves.length,
        textEditCount: plan.textEdits.length,
        warningCount: plan.warnings.length,
      },
    };

    const historyDir = path.join(plan.rootPath, '.filerefactor', 'history');
    await fs.mkdir(historyDir, { recursive: true });
    const manifestPath = path.join(historyDir, `${manifest.id}.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    for (const [relPath, afterContent] of afterContentByRel) {
      await fs.writeFile(absFromRel(plan.rootPath, relPath), afterContent, 'utf8');
    }

    for (const move of plan.fileMoves) {
      const fromAbs = absFromRel(plan.rootPath, move.fromRel);
      const toAbs = absFromRel(plan.rootPath, move.toRel);
      await fs.mkdir(path.dirname(toAbs), { recursive: true });
      await fs.rename(fromAbs, toAbs);
    }

    return { ok: true, manifestPath, manifest, errors: [] };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors };
  }
}

export function applyTextEdits(content: string, edits: TextEdit[]): string {
  let next = content;
  const descending = [...edits].sort((a, b) => b.start - a.start);
  for (const edit of descending) {
    const actual = next.slice(edit.start, edit.end);
    if (actual !== edit.oldText) {
      throw new Error(`Text edit mismatch in ${edit.sourceRel} at ${edit.start}: expected "${edit.oldText}", found "${actual}"`);
    }
    next = `${next.slice(0, edit.start)}${edit.newText}${next.slice(edit.end)}`;
  }
  return next;
}

function groupEdits(edits: TextEdit[]): Map<string, TextEdit[]> {
  const grouped = new Map<string, TextEdit[]>();
  for (const edit of edits) {
    const list = grouped.get(edit.sourceRel) ?? [];
    list.push(edit);
    grouped.set(edit.sourceRel, list);
  }
  return grouped;
}
