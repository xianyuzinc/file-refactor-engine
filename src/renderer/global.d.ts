import type {
  ApplyResult,
  DiffPreview,
  ProjectIndex,
  RefactorOperation,
  RefactorPlan,
  RollbackResult,
} from '@core/types';

declare global {
  interface Window {
    fileRefactor: {
      selectProject: () => Promise<string | null>;
      scanProject: (rootPath: string) => Promise<ProjectIndex>;
      buildPlan: (rootPath: string, operation: RefactorOperation) => Promise<RefactorPlan>;
      buildDiff: (plan: RefactorPlan) => Promise<DiffPreview[]>;
      applyPlan: (plan: RefactorPlan) => Promise<ApplyResult>;
      listRollbacks: (rootPath: string) => Promise<Array<{ id: string; path: string; appliedAt: string }>>;
      rollback: (manifestPath: string) => Promise<RollbackResult>;
    };
  }
}

export {};
