export type SupportedFileType =
  | 'tex'
  | 'markdown'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'matlab'
  | 'c-family'
  | 'jvm'
  | 'go'
  | 'rust'
  | 'dotnet'
  | 'php'
  | 'ruby'
  | 'lua'
  | 'shell'
  | 'r'
  | 'julia'
  | 'html'
  | 'css'
  | 'ipynb'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'bibtex'
  | 'other';

export type ReferenceResolution = 'resolved' | 'unresolved' | 'external' | 'absolute';
export type RefactorOperationType = 'move' | 'rename';

export interface IndexedFile {
  relPath: string;
  absPath: string;
  type: SupportedFileType;
  size: number;
  mtimeMs: number;
  sha256: string;
  isText: boolean;
}

export interface ProjectIndex {
  rootPath: string;
  files: IndexedFile[];
  filesByRel: Record<string, IndexedFile>;
  generatedAt: string;
}

export interface ReferenceEdge {
  id: string;
  sourceRel: string;
  sourceType: SupportedFileType;
  parser: string;
  kind: string;
  start: number;
  end: number;
  raw: string;
  resolvedTargetRel?: string;
  resolution: ReferenceResolution;
  reason?: string;
  preserveExtensionless: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface FileMove {
  fromRel: string;
  toRel: string;
  kind: 'file' | 'directory';
}

export interface TextEdit {
  sourceRel: string;
  start: number;
  end: number;
  oldText: string;
  newText: string;
  referenceId: string;
  resolvedTargetRel: string;
}

export interface PlanWarning {
  code:
    | 'conflict'
    | 'unresolved-reference'
    | 'external-reference'
    | 'absolute-reference'
    | 'unsupported-file'
    | 'unsafe-path'
    | 'noop';
  message: string;
  fileRel?: string;
  details?: Record<string, unknown>;
}

export interface RefactorPlan {
  id: string;
  rootPath: string;
  operation: RefactorOperation;
  createdAt: string;
  canApply: boolean;
  fileMoves: FileMove[];
  textEdits: TextEdit[];
  references: ReferenceEdge[];
  warnings: PlanWarning[];
  affectedTextFiles: string[];
}

export type RefactorOperation = MoveOperation | RenameOperation;

export interface MoveOperation {
  type: 'move';
  sourceRel: string;
  destinationRel: string;
}

export interface RenameOperation {
  type: 'rename';
  pattern: string;
  template: string;
  mode: 'glob' | 'regex';
}

export interface TextFileBackup {
  relPathBefore: string;
  relPathAfter: string;
  beforeHash: string;
  afterHash: string;
  beforeContent: string;
}

export interface RollbackManifest {
  id: string;
  rootPath: string;
  appliedAt: string;
  operation: RefactorOperation;
  fileMoves: FileMove[];
  textBackups: TextFileBackup[];
  planSummary: {
    fileMoveCount: number;
    textEditCount: number;
    warningCount: number;
  };
}

export interface ApplyResult {
  ok: boolean;
  manifestPath?: string;
  manifest?: RollbackManifest;
  errors: string[];
}

export interface DiffPreview {
  fileRel: string;
  oldText: string;
  newText: string;
  patch: string;
}

export interface RollbackResult {
  ok: boolean;
  restoredFiles: string[];
  skippedFiles: string[];
  errors: string[];
}
