import fs from 'node:fs/promises';
import { createPatch } from 'diff';
import { DiffPreview, RefactorPlan } from './types.js';
import { absFromRel } from './pathUtils.js';
import { applyTextEdits } from './apply.js';

export async function buildDiffPreview(plan: RefactorPlan): Promise<DiffPreview[]> {
  const grouped = new Map<string, typeof plan.textEdits>();
  for (const edit of plan.textEdits) {
    const list = grouped.get(edit.sourceRel) ?? [];
    list.push(edit);
    grouped.set(edit.sourceRel, list);
  }

  const previews: DiffPreview[] = [];
  for (const [fileRel, edits] of grouped) {
    const oldText = await fs.readFile(absFromRel(plan.rootPath, fileRel), 'utf8');
    const newText = applyTextEdits(oldText, edits);
    previews.push({
      fileRel,
      oldText,
      newText,
      patch: createPatch(fileRel, oldText, newText, 'before', 'after'),
    });
  }
  return previews.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
}
