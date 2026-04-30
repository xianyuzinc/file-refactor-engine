import { type CSSProperties, useMemo, useState } from 'react';
import type {
  ApplyResult,
  DiffPreview,
  ProjectIndex,
  RefactorOperation,
  RefactorPlan,
  RollbackResult,
} from '@core/types';

type BusyState = 'idle' | 'scanning' | 'planning' | 'diffing' | 'applying' | 'rolling-back';

type FileTreeNode = {
  name: string;
  relPath: string;
  kind: 'directory' | 'file';
  type?: string;
  children: FileTreeNode[];
  fileCount: number;
};

type VisibleTreeRow = {
  node: FileTreeNode;
  depth: number;
};

export function App() {
  const [rootPath, setRootPath] = useState('');
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [operationType, setOperationType] = useState<'move' | 'rename'>('move');
  const [moveSource, setMoveSource] = useState('figures');
  const [moveDestination, setMoveDestination] = useState('paper/figures');
  const [renamePattern, setRenamePattern] = useState('case_*.png');
  const [renameTemplate, setRenameTemplate] = useState('case_{1}_renamed{ext}');
  const [renameMode, setRenameMode] = useState<'glob' | 'regex'>('glob');
  const [plan, setPlan] = useState<RefactorPlan | null>(null);
  const [diffs, setDiffs] = useState<DiffPreview[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; path: string; appliedAt: string }>>([]);
  const [busy, setBusy] = useState<BusyState>('idle');
  const [message, setMessage] = useState('');
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const [treeFilter, setTreeFilter] = useState('');
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() => new Set());

  const supportedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of index?.files ?? []) counts.set(file.type, (counts.get(file.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [index]);
  const fileTree = useMemo(() => buildFileTree(index?.files ?? []), [index]);
  const visibleTreeRows = useMemo(
    () => flattenFileTree(fileTree, expandedTreePaths, treeFilter),
    [expandedTreePaths, fileTree, treeFilter],
  );
  const directoryPaths = useMemo(() => collectDirectoryPaths(fileTree), [fileTree]);

  async function chooseProject() {
    const selected = await window.fileRefactor.selectProject();
    if (!selected) return;
    setRootPath(selected);
    await scan(selected);
  }

  async function scan(pathOverride = rootPath) {
    if (!pathOverride) return;
    setBusy('scanning');
    setMessage('');
    setPlan(null);
    setDiffs([]);
    setApplyResult(null);
    setRollbackResult(null);
    try {
      const nextIndex = await window.fileRefactor.scanProject(pathOverride);
      const nextHistory = await window.fileRefactor.listRollbacks(pathOverride);
      setIndex(nextIndex);
      setHistory(nextHistory);
      setExpandedTreePaths(defaultExpandedPaths(nextIndex.files));
      setMessage(`Indexed ${nextIndex.files.length} files.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  }

  function currentOperation(): RefactorOperation {
    if (operationType === 'move') {
      return { type: 'move', sourceRel: moveSource.trim(), destinationRel: moveDestination.trim() };
    }
    return { type: 'rename', pattern: renamePattern.trim(), template: renameTemplate.trim(), mode: renameMode };
  }

  async function dryRun() {
    if (!rootPath) return;
    setBusy('planning');
    setMessage('');
    setPlan(null);
    setDiffs([]);
    setApplyResult(null);
    setRollbackResult(null);
    try {
      const nextPlan = await window.fileRefactor.buildPlan(rootPath, currentOperation());
      setPlan(nextPlan);
      setMessage(nextPlan.canApply ? 'Dry-run complete. Review the plan before applying.' : 'Dry-run found blockers.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  }

  async function buildDiff() {
    if (!plan) return;
    setBusy('diffing');
    setMessage('');
    try {
      setDiffs(await window.fileRefactor.buildDiff(plan));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  }

  async function applyPlan() {
    if (!plan || !plan.canApply) return;
    setBusy('applying');
    setMessage('');
    try {
      const result = await window.fileRefactor.applyPlan(plan);
      setApplyResult(result);
      setMessage(result.ok ? 'Refactor applied. Rollback manifest saved.' : 'Apply failed.');
      await scan(rootPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  }

  async function rollback(manifestPath: string) {
    setBusy('rolling-back');
    setMessage('');
    try {
      const result = await window.fileRefactor.rollback(manifestPath);
      setRollbackResult(result);
      setMessage(result.ok ? 'Rollback complete.' : 'Rollback completed with conflicts.');
      await scan(rootPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  }

  function clearPreview() {
    setPlan(null);
    setDiffs([]);
    setApplyResult(null);
    setRollbackResult(null);
  }

  function toggleTreeNode(relPath: string) {
    setExpandedTreePaths((previous) => {
      const next = new Set(previous);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }

  function expandAllTreeNodes() {
    setExpandedTreePaths(new Set(directoryPaths));
  }

  function collapseAllTreeNodes() {
    setExpandedTreePaths(new Set());
  }

  function setMoveSourceFromTree(relPath: string) {
    setOperationType('move');
    setMoveSource(relPath);
    clearPreview();
    setMessage(`Move source set to ${relPath}.`);
  }

  function setMoveDestinationFromTree(relPath: string) {
    const sourceName = basenameFromRelPath(moveSource);
    const destination = sourceName ? joinRelPath(relPath, sourceName) : relPath;
    setOperationType('move');
    setMoveDestination(destination);
    clearPreview();
    setMessage(`Move destination set to ${destination}.`);
  }

  function setRenamePatternFromTree(node: FileTreeNode) {
    setOperationType('rename');
    setRenameMode('glob');
    setRenamePattern(node.kind === 'directory' ? joinRelPath(node.relPath, '*') : node.relPath);
    clearPreview();
    setMessage(`Rename pattern set from ${node.relPath}.`);
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Dependency-aware filesystem refactoring</p>
          <h1>File Refactor Engine</h1>
        </div>
        <div className="hero-actions">
          <button onClick={chooseProject} disabled={busy !== 'idle'}>Choose Project</button>
          <button className="secondary" onClick={() => scan()} disabled={!rootPath || busy !== 'idle'}>Rescan</button>
        </div>
      </header>

      <section className="project-bar">
        <label>
          Project root
          <input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="C:/path/to/project" />
        </label>
        <button onClick={() => scan()} disabled={!rootPath || busy !== 'idle'}>Index Folder</button>
      </section>

      {message && <div className="notice">{message}</div>}

      <div className="workspace-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Project Index</h2>
            <span>{index ? `${index.files.length} files` : 'No project selected'}</span>
          </div>
          <div className="metric-row">
            {supportedCounts.map(([type, count]) => (
              <span className="chip" key={type}>{type}: {count}</span>
            ))}
          </div>
          <div className="tree-toolbar">
            <input
              value={treeFilter}
              onChange={(event) => setTreeFilter(event.target.value)}
              placeholder="Filter project tree"
              aria-label="Filter project tree"
              disabled={!index}
            />
            <button className="secondary compact" onClick={expandAllTreeNodes} disabled={!index}>Expand</button>
            <button className="secondary compact" onClick={collapseAllTreeNodes} disabled={!index}>Collapse</button>
          </div>
          <div className="file-tree" role="tree" aria-label="Indexed project files">
            {!index && <div className="tree-empty">Choose a project to inspect its files.</div>}
            {index && visibleTreeRows.length === 0 && <div className="tree-empty">No files match the current filter.</div>}
            {visibleTreeRows.map(({ node, depth }) => {
              const isDirectory = node.kind === 'directory';
              const isExpanded = expandedTreePaths.has(node.relPath);
              const depthStyle = { '--tree-depth': depth } as CSSProperties;
              return (
                <div
                  className={`tree-row ${node.kind}`}
                  key={node.relPath}
                  role="treeitem"
                  aria-expanded={isDirectory ? isExpanded || Boolean(treeFilter) : undefined}
                  style={depthStyle}
                >
                  <button
                    className="tree-toggle"
                    onClick={() => isDirectory && toggleTreeNode(node.relPath)}
                    disabled={!isDirectory}
                    aria-label={isDirectory ? `${isExpanded ? 'Collapse' : 'Expand'} ${node.name}` : undefined}
                  >
                    {isDirectory ? (isExpanded || treeFilter ? '▾' : '▸') : '•'}
                  </button>
                  <button
                    className="tree-name"
                    onClick={() => (isDirectory ? toggleTreeNode(node.relPath) : setMoveSourceFromTree(node.relPath))}
                    title={node.relPath}
                  >
                    <span className="tree-symbol" aria-hidden="true">{isDirectory ? 'dir' : 'file'}</span>
                    <span className="tree-label">{node.name}</span>
                    {isDirectory && <span className="tree-count">{node.fileCount}</span>}
                  </button>
                  {node.kind === 'file' && <span className={`badge ${node.type ?? 'other'}`}>{node.type}</span>}
                  {node.kind === 'directory' && <span className="tree-spacer" />}
                  <div className="tree-actions">
                    <button className="micro" onClick={() => setMoveSourceFromTree(node.relPath)}>Source</button>
                    {isDirectory && <button className="micro secondary" onClick={() => setMoveDestinationFromTree(node.relPath)}>Dest</button>}
                    <button className="micro secondary" onClick={() => setRenamePatternFromTree(node)}>Pattern</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Operation Builder</h2>
            <span>{busy === 'idle' ? 'Ready' : busy}</span>
          </div>
          <div className="segmented">
            <button className={operationType === 'move' ? 'active' : ''} onClick={() => setOperationType('move')}>Move</button>
            <button className={operationType === 'rename' ? 'active' : ''} onClick={() => setOperationType('rename')}>Rename</button>
          </div>

          {operationType === 'move' ? (
            <div className="form-stack">
              <label>
                Source file or directory
                <input value={moveSource} onChange={(event) => setMoveSource(event.target.value)} placeholder="figures" />
              </label>
              <label>
                Destination path
                <input value={moveDestination} onChange={(event) => setMoveDestination(event.target.value)} placeholder="paper/figures" />
              </label>
            </div>
          ) : (
            <div className="form-stack">
              <label>
                Match mode
                <select value={renameMode} onChange={(event) => setRenameMode(event.target.value as 'glob' | 'regex')}>
                  <option value="glob">glob</option>
                  <option value="regex">regex</option>
                </select>
              </label>
              <label>
                Pattern
                <input value={renamePattern} onChange={(event) => setRenamePattern(event.target.value)} placeholder="case_*.png" />
              </label>
              <label>
                Template
                <input value={renameTemplate} onChange={(event) => setRenameTemplate(event.target.value)} placeholder="Re_{1}_case{ext}" />
              </label>
              <p className="hint">Template tokens: {'{stem}'}, {'{ext}'}, {'{index}'}, {'{1}'}, and regex named groups such as {'{Re}'}.</p>
            </div>
          )}

          <div className="button-row">
            <button onClick={dryRun} disabled={!rootPath || busy !== 'idle'}>Dry-run</button>
            <button className="secondary" onClick={buildDiff} disabled={!plan || plan.textEdits.length === 0 || busy !== 'idle'}>Build Diff</button>
            <button className="danger" onClick={applyPlan} disabled={!plan?.canApply || busy !== 'idle'}>Apply Refactor</button>
          </div>
        </section>
      </div>

      {plan && (
        <section className="panel wide">
          <div className="panel-header">
            <h2>Dry-run Report</h2>
            <span className={plan.canApply ? 'status-ok' : 'status-blocked'}>{plan.canApply ? 'applyable' : 'blocked'}</span>
          </div>
          <div className="summary-grid">
            <Metric label="File moves" value={plan.fileMoves.length} />
            <Metric label="Text edits" value={plan.textEdits.length} />
            <Metric label="Resolved references" value={plan.references.filter((ref) => ref.resolution === 'resolved').length} />
            <Metric label="Warnings" value={plan.warnings.length} />
          </div>

          <h3>File Operations</h3>
          <div className="table-like">
            {plan.fileMoves.map((move) => (
              <div className="table-row" key={`${move.fromRel}->${move.toRel}`}>
                <span>{move.kind}</span>
                <code>{move.fromRel}</code>
                <span>→</span>
                <code>{move.toRel}</code>
              </div>
            ))}
          </div>

          <h3>Reference Updates</h3>
          <div className="table-like">
            {plan.textEdits.map((edit) => (
              <div className="table-row" key={`${edit.sourceRel}-${edit.start}`}>
                <code>{edit.sourceRel}</code>
                <code>{edit.oldText}</code>
                <span>→</span>
                <code>{edit.newText}</code>
              </div>
            ))}
          </div>

          <h3>Warnings</h3>
          <div className="warning-list">
            {plan.warnings.length === 0 && <span className="muted">No warnings.</span>}
            {plan.warnings.slice(0, 200).map((warning, index) => (
              <div className={`warning ${warning.code}`} key={`${warning.code}-${index}`}>
                <strong>{warning.code}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {diffs.length > 0 && (
        <section className="panel wide">
          <div className="panel-header">
            <h2>Diff Preview</h2>
            <span>{diffs.length} files</span>
          </div>
          {diffs.map((diff) => (
            <details className="diff-block" key={diff.fileRel} open>
              <summary>{diff.fileRel}</summary>
              <pre>{diff.patch}</pre>
            </details>
          ))}
        </section>
      )}

      <section className="panel wide">
        <div className="panel-header">
          <h2>History And Rollback</h2>
          <span>{history.length} manifests</span>
        </div>
        {applyResult && <ResultBlock title="Apply result" ok={applyResult.ok} errors={applyResult.errors} extra={applyResult.manifestPath} />}
        {rollbackResult && <ResultBlock title="Rollback result" ok={rollbackResult.ok} errors={rollbackResult.errors} extra={`${rollbackResult.restoredFiles.length} restored, ${rollbackResult.skippedFiles.length} skipped`} />}
        <div className="history-list">
          {history.length === 0 && <span className="muted">No rollback manifests yet.</span>}
          {history.map((item) => (
            <div className="history-row" key={item.path}>
              <div>
                <strong>{item.id}</strong>
                <span>{new Date(item.appliedAt).toLocaleString()}</span>
              </div>
              <button className="secondary" onClick={() => rollback(item.path)} disabled={busy !== 'idle'}>Rollback</button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ResultBlock({ title, ok, errors, extra }: { title: string; ok: boolean; errors: string[]; extra?: string }) {
  return (
    <div className={`result ${ok ? 'ok' : 'failed'}`}>
      <strong>{title}: {ok ? 'OK' : 'Failed'}</strong>
      {extra && <code>{extra}</code>}
      {errors.map((error) => <span key={error}>{error}</span>)}
    </div>
  );
}

function buildFileTree(files: ProjectIndex['files']): FileTreeNode {
  const root: FileTreeNode = { name: 'Project', relPath: '', kind: 'directory', children: [], fileCount: 0 };
  const directories = new Map<string, FileTreeNode>([['', root]]);

  for (const file of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const parts = file.relPath.split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const nextPath = currentPath ? `${currentPath}/${name}` : name;
      const isFile = index === parts.length - 1;

      if (isFile) {
        current.children.push({
          name,
          relPath: file.relPath,
          kind: 'file',
          type: file.type,
          children: [],
          fileCount: 1,
        });
        continue;
      }

      let directory = directories.get(nextPath);
      if (!directory) {
        directory = { name, relPath: nextPath, kind: 'directory', children: [], fileCount: 0 };
        directories.set(nextPath, directory);
        current.children.push(directory);
      }
      current = directory;
      currentPath = nextPath;
    }
  }

  calculateFileCounts(root);
  sortTree(root);
  return root;
}

function calculateFileCounts(node: FileTreeNode): number {
  if (node.kind === 'file') return 1;
  node.fileCount = node.children.reduce((sum, child) => sum + calculateFileCounts(child), 0);
  return node.fileCount;
}

function sortTree(node: FileTreeNode) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  for (const child of node.children) sortTree(child);
}

function flattenFileTree(root: FileTreeNode, expandedPaths: Set<string>, filter: string): VisibleTreeRow[] {
  const normalizedFilter = filter.trim().toLowerCase();
  const rows: VisibleTreeRow[] = [];

  function matches(node: FileTreeNode): boolean {
    if (!normalizedFilter) return true;
    return (
      node.name.toLowerCase().includes(normalizedFilter) ||
      node.relPath.toLowerCase().includes(normalizedFilter) ||
      (node.type?.toLowerCase().includes(normalizedFilter) ?? false)
    );
  }

  function hasMatch(node: FileTreeNode): boolean {
    return matches(node) || node.children.some(hasMatch);
  }

  function walk(parent: FileTreeNode, depth: number) {
    for (const child of parent.children) {
      if (normalizedFilter && !hasMatch(child)) continue;
      rows.push({ node: child, depth });
      if (child.kind === 'directory' && (normalizedFilter || expandedPaths.has(child.relPath))) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return rows;
}

function collectDirectoryPaths(root: FileTreeNode): string[] {
  const paths: string[] = [];

  function walk(node: FileTreeNode) {
    if (node.kind !== 'directory') return;
    if (node.relPath) paths.push(node.relPath);
    for (const child of node.children) walk(child);
  }

  walk(root);
  return paths;
}

function defaultExpandedPaths(files: ProjectIndex['files']): Set<string> {
  const paths = new Set<string>();
  const expandDepth = files.length <= 160 ? Number.POSITIVE_INFINITY : 2;

  for (const file of files) {
    const parts = file.relPath.split('/').filter(Boolean);
    let currentPath = '';
    for (let index = 0; index < parts.length - 1 && index < expandDepth; index += 1) {
      currentPath = currentPath ? `${currentPath}/${parts[index]}` : parts[index];
      paths.add(currentPath);
    }
  }

  return paths;
}

function basenameFromRelPath(relPath: string): string {
  return relPath.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

function joinRelPath(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)
    .join('/');
}
