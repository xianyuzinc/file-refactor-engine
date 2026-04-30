import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApplyResult,
  DiffPreview,
  ProjectIndex,
  RefactorOperation,
  RefactorPlan,
  RollbackResult,
} from '../core/types';

contextBridge.exposeInMainWorld('fileRefactor', {
  selectProject: (): Promise<string | null> => ipcRenderer.invoke('project:select'),
  scanProject: (rootPath: string): Promise<ProjectIndex> => ipcRenderer.invoke('project:scan', rootPath),
  buildPlan: (rootPath: string, operation: RefactorOperation): Promise<RefactorPlan> => ipcRenderer.invoke('refactor:plan', rootPath, operation),
  buildDiff: (plan: RefactorPlan): Promise<DiffPreview[]> => ipcRenderer.invoke('refactor:diff', plan),
  applyPlan: (plan: RefactorPlan): Promise<ApplyResult> => ipcRenderer.invoke('refactor:apply', plan),
  listRollbacks: (rootPath: string): Promise<Array<{ id: string; path: string; appliedAt: string }>> => ipcRenderer.invoke('rollback:list', rootPath),
  rollback: (manifestPath: string): Promise<RollbackResult> => ipcRenderer.invoke('rollback:run', manifestPath),
});
