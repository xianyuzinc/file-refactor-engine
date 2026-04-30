import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyRefactorPlan,
  buildRefactorPlan,
  rollbackFromManifestFile,
} from '../src/core/index';

const tempProjects: string[] = [];

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filerefactor-'));
  tempProjects.push(root);
  return root;
}

async function writeFile(root: string, relPath: string, content: string | Buffer = ''): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function readFile(root: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

async function exists(root: string, relPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, relPath));
    return true;
  } catch {
    return false;
  }
}

describe('File Refactor Engine core', () => {
  afterEach(async () => {
    const roots = tempProjects.splice(0, tempProjects.length);
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('moves a LaTeX figure directory and updates includegraphics references', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'main.tex', String.raw`\includegraphics{figures/drag.png}`);
    await writeFile(root, 'figures/drag.png', Buffer.from([1, 2, 3]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'figures', destinationRel: 'paper/figures' });
    expect(plan.canApply).toBe(true);
    expect(plan.fileMoves).toHaveLength(1);
    expect(plan.textEdits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRel: 'main.tex', oldText: 'figures/drag.png', newText: 'paper/figures/drag.png' }),
      ]),
    );

    const applied = await applyRefactorPlan(plan);
    expect(applied.ok).toBe(true);
    expect(await readFile(root, 'main.tex')).toContain('paper/figures/drag.png');
    expect(await exists(root, 'paper/figures/drag.png')).toBe(true);

    const rolledBack = await rollbackFromManifestFile(applied.manifestPath!);
    expect(rolledBack.ok).toBe(true);
    expect(await readFile(root, 'main.tex')).toContain('figures/drag.png');
    expect(await exists(root, 'figures/drag.png')).toBe(true);
  });

  it('renames Markdown-linked images with glob capture tokens', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'README.md', '![case](case_100.png)\n');
    await writeFile(root, 'case_100.png', Buffer.from([1]));

    const plan = await buildRefactorPlan(root, {
      type: 'rename',
      mode: 'glob',
      pattern: 'case_*.png',
      template: 'Re_{1}_case{ext}',
    });

    expect(plan.canApply).toBe(true);
    expect(plan.fileMoves[0]).toMatchObject({ fromRel: 'case_100.png', toRel: 'Re_100_case.png' });
    expect(plan.textEdits[0]).toMatchObject({ oldText: 'case_100.png', newText: 'Re_100_case.png' });
  });

  it('updates Python, JSON, and YAML string references without reformatting whole files', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'script.py', 'DATA = "data/input.csv"\n');
    await writeFile(root, 'config.json', '{\n  "path": "data/input.csv",\n  "keep": true\n}\n');
    await writeFile(root, 'config.yaml', 'path: data/input.csv\nname: demo\n');
    await writeFile(root, 'data/input.csv', 'x,y\n1,2\n');

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'data', destinationRel: 'assets/data' });
    expect(plan.canApply).toBe(true);
    expect(plan.textEdits.map((edit) => edit.sourceRel).sort()).toEqual(['config.json', 'config.yaml', 'script.py']);

    const applied = await applyRefactorPlan(plan);
    expect(applied.ok).toBe(true);
    expect(await readFile(root, 'script.py')).toContain('assets/data/input.csv');
    expect(await readFile(root, 'config.json')).toContain('"path": "assets/data/input.csv"');
    expect(await readFile(root, 'config.yaml')).toContain('path: assets/data/input.csv');
  });

  it('updates common code, MATLAB, HTML, CSS, TOML, and BibTeX references', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'src/app.js', 'const plot = "../assets/plot.png";\n');
    await writeFile(root, 'src/module.ts', 'export const data = "../assets/input.csv";\n');
    await writeFile(root, 'matlab/analyze.m', "dataFile = '../assets/input.csv';\nplotFile = \"../assets/plot.png\";\n");
    await writeFile(root, 'styles/site.css', 'body { background-image: url("../assets/plot.png"); }\n');
    await writeFile(root, 'index.html', '<img src="assets/plot.png">\n<a href="assets/input.csv">data</a>\n');
    await writeFile(root, 'settings.toml', 'input = "assets/input.csv"\n');
    await writeFile(root, 'refs.bib', '@misc{demo,\n  file = {assets/paper.pdf}\n}\n');
    await writeFile(root, 'assets/plot.png', Buffer.from([1]));
    await writeFile(root, 'assets/input.csv', 'x,y\n1,2\n');
    await writeFile(root, 'assets/paper.pdf', Buffer.from([2]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'assets', destinationRel: 'public/assets' });
    expect(plan.canApply).toBe(true);
    expect(plan.textEdits.map((edit) => edit.sourceRel).sort()).toEqual([
      'index.html',
      'index.html',
      'matlab/analyze.m',
      'matlab/analyze.m',
      'refs.bib',
      'settings.toml',
      'src/app.js',
      'src/module.ts',
      'styles/site.css',
    ]);

    const applied = await applyRefactorPlan(plan);
    expect(applied.ok).toBe(true);
    expect(await readFile(root, 'src/app.js')).toContain('../public/assets/plot.png');
    expect(await readFile(root, 'src/module.ts')).toContain('../public/assets/input.csv');
    expect(await readFile(root, 'matlab/analyze.m')).toContain('../public/assets/input.csv');
    expect(await readFile(root, 'matlab/analyze.m')).toContain('../public/assets/plot.png');
    expect(await readFile(root, 'styles/site.css')).toContain('../public/assets/plot.png');
    expect(await readFile(root, 'index.html')).toContain('public/assets/plot.png');
    expect(await readFile(root, 'settings.toml')).toContain('public/assets/input.csv');
    expect(await readFile(root, 'refs.bib')).toContain('public/assets/paper.pdf');
  });

  it('updates notebook source references but leaves outputs untouched', async () => {
    const root = await makeTempProject();
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: ['![plot](figures/a.png)\n'], metadata: {} },
        {
          cell_type: 'code',
          source: ['path = "figures/a.png"\n'],
          outputs: [{ output_type: 'stream', text: ['figures/a.png\n'] }],
          metadata: {},
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    await writeFile(root, 'analysis.ipynb', `${JSON.stringify(notebook, null, 2)}\n`);
    await writeFile(root, 'figures/a.png', Buffer.from([1]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'figures', destinationRel: 'paper/figures' });
    expect(plan.textEdits.filter((edit) => edit.sourceRel === 'analysis.ipynb')).toHaveLength(2);

    const applied = await applyRefactorPlan(plan);
    expect(applied.ok).toBe(true);
    const next = await readFile(root, 'analysis.ipynb');
    expect(next).toContain('paper/figures/a.png');
    expect(next).toContain('figures/a.png\\n');
  });

  it('blocks moves that would overwrite existing destinations', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'figures/a.png', Buffer.from([1]));
    await writeFile(root, 'paper/figures/existing.txt', 'already here');

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'figures', destinationRel: 'paper/figures' });
    expect(plan.canApply).toBe(false);
    expect(plan.warnings.some((warning) => warning.code === 'conflict')).toBe(true);
  });

  it('reports external and absolute references without auto-updating them', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'README.md', '[site](https://example.com/a.png)\n![abs](C:/tmp/a.png)\n');
    await writeFile(root, 'figures/a.png', Buffer.from([1]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'figures', destinationRel: 'paper/figures' });
    expect(plan.textEdits).toHaveLength(0);
    expect(plan.warnings.some((warning) => warning.code === 'external-reference')).toBe(true);
    expect(plan.warnings.some((warning) => warning.code === 'absolute-reference')).toBe(true);
  });

  it('does not overwrite user-edited text during rollback', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'main.tex', String.raw`\includegraphics{figures/drag.png}`);
    await writeFile(root, 'figures/drag.png', Buffer.from([1]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'figures', destinationRel: 'paper/figures' });
    const applied = await applyRefactorPlan(plan);
    expect(applied.ok).toBe(true);
    await writeFile(root, 'main.tex', 'user changed this file after apply\n');

    const rolledBack = await rollbackFromManifestFile(applied.manifestPath!);
    expect(rolledBack.ok).toBe(false);
    expect(rolledBack.skippedFiles).toContain('main.tex');
    expect(await readFile(root, 'main.tex')).toContain('user changed');
  });

  it('handles paths with spaces', async () => {
    const root = await makeTempProject();
    await writeFile(root, 'paper/main.tex', String.raw`\includegraphics{../old figs/drag map.png}`);
    await writeFile(root, 'old figs/drag map.png', Buffer.from([1]));

    const plan = await buildRefactorPlan(root, { type: 'move', sourceRel: 'old figs', destinationRel: 'paper figs' });
    expect(plan.canApply).toBe(true);
    expect(plan.textEdits[0]).toMatchObject({ oldText: '../old figs/drag map.png', newText: '../paper figs/drag map.png' });
  });
});
