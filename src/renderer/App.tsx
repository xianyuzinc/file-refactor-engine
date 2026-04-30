import { useMemo, useState } from 'react';
import type {
  ApplyResult,
  DiffPreview,
  ProjectIndex,
  RefactorOperation,
  RefactorPlan,
  RollbackResult,
} from '@core/types';

type BusyState = 'idle' | 'scanning' | 'planning' | 'diffing' | 'applying' | 'rolling-back';

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

  const supportedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of index?.files ?? []) counts.set(file.type, (counts.get(file.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [index]);

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
          <div className="file-list">
            {(index?.files ?? []).slice(0, 160).map((file) => (
              <div className="file-row" key={file.relPath}>
                <span className={`badge ${file.type}`}>{file.type}</span>
                <code>{file.relPath}</code>
              </div>
            ))}
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
