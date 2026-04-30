import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectIndex, ReferenceEdge, SupportedFileType } from './types.js';
import {
  dirnameRel,
  hasGlobMagic,
  isAnchorLike,
  isInsideRoot,
  isUrlLike,
  normalizeRel,
  toPosixPath,
} from './pathUtils.js';

interface Candidate {
  start: number;
  end: number;
  raw: string;
  parser: string;
  kind: string;
}

const TEX_EXTENSIONS_BY_KIND: Record<string, string[]> = {
  'tex.includegraphics': ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg'],
  'tex.input': ['.tex'],
  'tex.include': ['.tex'],
  'tex.bibliography': ['.bib'],
  'tex.addbibresource': ['.bib'],
};

const CODE_FILE_TYPES = new Set<SupportedFileType>([
  'python',
  'javascript',
  'typescript',
  'matlab',
  'c-family',
  'jvm',
  'go',
  'rust',
  'dotnet',
  'php',
  'ruby',
  'lua',
  'shell',
  'r',
  'julia',
]);

const GENERIC_EXTENSIONS = [
  '.tex',
  '.md',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.m',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.java',
  '.go',
  '.rs',
  '.cs',
  '.r',
  '.jl',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.bib',
  '.csv',
  '.tsv',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.pdf',
];

export async function extractReferences(index: ProjectIndex): Promise<ReferenceEdge[]> {
  const references: ReferenceEdge[] = [];
  let counter = 0;

  for (const file of index.files) {
    if (!isSupportedReferenceSource(file.type)) continue;
    const text = await fs.readFile(file.absPath, 'utf8');
    const candidates = extractCandidates(text, file.type);
    for (const candidate of candidates) {
      const resolved = resolveCandidate(index, file.relPath, candidate);
      references.push({
        id: `R${++counter}`,
        sourceRel: file.relPath,
        sourceType: file.type,
        parser: candidate.parser,
        kind: candidate.kind,
        start: candidate.start,
        end: candidate.end,
        raw: candidate.raw,
        resolvedTargetRel: resolved.resolvedTargetRel,
        resolution: resolved.resolution,
        reason: resolved.reason,
        preserveExtensionless: resolved.preserveExtensionless,
        confidence: resolved.resolution === 'resolved' ? 'high' : 'medium',
      });
    }
  }

  return references;
}

function isSupportedReferenceSource(type: SupportedFileType): boolean {
  return (
    type === 'tex' ||
    type === 'markdown' ||
    CODE_FILE_TYPES.has(type) ||
    type === 'html' ||
    type === 'css' ||
    type === 'ipynb' ||
    type === 'json' ||
    type === 'yaml' ||
    type === 'toml' ||
    type === 'bibtex'
  );
}

function extractCandidates(text: string, type: SupportedFileType): Candidate[] {
  switch (type) {
    case 'tex':
      return extractTexCandidates(text);
    case 'markdown':
      return extractMarkdownCandidates(text, 0, 'markdown.link');
    case 'html':
      return extractHtmlCandidates(text);
    case 'css':
      return extractCssCandidates(text);
    case 'ipynb':
      return extractNotebookCandidates(text);
    case 'json':
      return extractJsonCandidates(text);
    case 'yaml':
      return extractYamlCandidates(text);
    case 'toml':
      return extractTomlCandidates(text);
    case 'bibtex':
      return extractBibtexCandidates(text);
    default:
      if (CODE_FILE_TYPES.has(type)) return extractCodeCandidates(text, type);
      return [];
  }
}

function extractTexCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const commandRe = /\\(includegraphics|input|include|bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = commandRe.exec(text))) {
    const command = match[1];
    const group = match[2];
    const groupStart = match.index + match[0].indexOf(group);
    const parts = command === 'bibliography' ? splitCommaParts(group) : [{ value: group.trim(), offset: group.indexOf(group.trim()) }];
    for (const part of parts) {
      if (!part.value) continue;
      candidates.push({
        start: groupStart + part.offset,
        end: groupStart + part.offset + part.value.length,
        raw: part.value,
        parser: 'tex',
        kind: `tex.${command}`,
      });
    }
  }
  return candidates;
}

function splitCommaParts(value: string): Array<{ value: string; offset: number }> {
  const parts: Array<{ value: string; offset: number }> = [];
  let cursor = 0;
  for (const rawPart of value.split(',')) {
    const trimmed = rawPart.trim();
    const localOffset = rawPart.indexOf(trimmed);
    parts.push({ value: trimmed, offset: cursor + Math.max(localOffset, 0) });
    cursor += rawPart.length + 1;
  }
  return parts;
}

function extractMarkdownCandidates(text: string, baseOffset: number, kind: string): Candidate[] {
  const candidates: Candidate[] = [];
  const linkRe = /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    const raw = match[1];
    const start = baseOffset + match.index + match[0].indexOf(raw);
    candidates.push({
      start,
      end: start + raw.length,
      raw,
      parser: 'markdown',
      kind,
    });
  }
  return candidates;
}

function extractCodeCandidates(text: string, type: SupportedFileType): Candidate[] {
  return [
    ...extractQuotedPathCandidates(text, 0, `${type}.string`),
    ...extractBacktickPathCandidates(text, 0, `${type}.template-string`),
  ];
}

function extractQuotedPathCandidates(text: string, baseOffset: number, kind: string): Candidate[] {
  const candidates: Candidate[] = [];
  const stringRe = /(?:[rRuUbBfF]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*?)')/g;
  let match: RegExpExecArray | null;
  while ((match = stringRe.exec(text))) {
    const full = match[1];
    const quote = full.startsWith('"""') || full.startsWith("'''") ? full.slice(0, 3) : full.slice(0, 1);
    const contentStartInFull = quote.length;
    const contentEndInFull = full.length - quote.length;
    const encodedContent = full.slice(contentStartInFull, contentEndInFull);
    if (encodedContent.includes('{') || encodedContent.includes('}')) continue;
    const decoded = decodeLooseString(encodedContent);
    if (!looksPathLike(decoded)) continue;
    const fullStart = match.index + match[0].indexOf(full);
    candidates.push({
      start: baseOffset + fullStart + contentStartInFull,
      end: baseOffset + fullStart + contentEndInFull,
      raw: decoded,
      parser: 'quoted-string',
      kind,
    });
  }
  return candidates;
}

function extractBacktickPathCandidates(text: string, baseOffset: number, kind: string): Candidate[] {
  const candidates: Candidate[] = [];
  const backtickRe = /`((?:\\.|[^`\\])*)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(text))) {
    const encodedContent = match[1];
    if (encodedContent.includes('${') || encodedContent.includes('{') || encodedContent.includes('}')) continue;
    const decoded = decodeLooseString(encodedContent);
    if (!looksPathLike(decoded)) continue;
    candidates.push({
      start: baseOffset + match.index + 1,
      end: baseOffset + match.index + 1 + encodedContent.length,
      raw: decoded,
      parser: 'template-string',
      kind,
    });
  }
  return candidates;
}

function extractHtmlCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const attrRe = /\b(src|href|poster|data|action)\s*=\s*(["'])(.*?)\2/gims;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(text))) {
    const raw = match[3].trim();
    if (!looksPathLike(raw)) continue;
    const start = match.index + match[0].lastIndexOf(match[3]);
    candidates.push({
      start,
      end: start + match[3].length,
      raw,
      parser: 'html',
      kind: `html.${match[1].toLowerCase()}`,
    });
  }
  return candidates;
}

function extractCssCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const urlRe = /\burl\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(text))) {
    const raw = match[2].trim();
    if (!looksPathLike(raw)) continue;
    const start = match.index + match[0].indexOf(match[2]);
    candidates.push({
      start,
      end: start + match[2].length,
      raw,
      parser: 'css',
      kind: 'css.url',
    });
  }

  const importRe = /@import\s+(?:url\(\s*)?(["'])([^"']+)\1/g;
  while ((match = importRe.exec(text))) {
    const raw = match[2].trim();
    if (!looksPathLike(raw)) continue;
    const start = match.index + match[0].lastIndexOf(match[2]);
    candidates.push({
      start,
      end: start + match[2].length,
      raw,
      parser: 'css',
      kind: 'css.import',
    });
  }

  return candidates;
}

function extractJsonCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const stringRe = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = stringRe.exec(text))) {
    const rawEncoded = match[1];
    const endQuote = match.index + match[0].length;
    const rest = text.slice(endQuote).match(/^\s*:/);
    if (rest) continue;
    const decoded = decodeLooseString(rawEncoded);
    if (!looksPathLike(decoded)) continue;
    candidates.push({
      start: match.index + 1,
      end: match.index + 1 + rawEncoded.length,
      raw: decoded,
      parser: 'json',
      kind: 'json.string',
    });
  }
  return candidates;
}

function extractTomlCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const quotedRe = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRe.exec(text))) {
    const decoded = decodeLooseString(match[2]);
    if (!looksPathLike(decoded)) continue;
    candidates.push({
      start: match.index + 1,
      end: match.index + 1 + match[2].length,
      raw: decoded,
      parser: 'toml',
      kind: 'toml.string',
    });
  }
  return candidates;
}

function extractBibtexCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const fieldRe = /\b(file|url|pdf|local-url)\s*=\s*(["{])([^"}]+)(["}])/gi;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(text))) {
    const raw = match[3].trim();
    if (!looksPathLike(raw)) continue;
    const start = match.index + match[0].indexOf(match[3]);
    candidates.push({
      start,
      end: start + match[3].length,
      raw,
      parser: 'bibtex',
      kind: `bibtex.${match[1].toLowerCase()}`,
    });
  }
  return candidates;
}

function extractYamlCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const quotedRe = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRe.exec(text))) {
    const decoded = decodeLooseString(match[2]);
    if (!looksPathLike(decoded)) continue;
    const after = text.slice(match.index + match[0].length).split(/\r?\n/, 1)[0];
    if (/^\s*:/.test(after)) continue;
    candidates.push({
      start: match.index + 1,
      end: match.index + 1 + match[2].length,
      raw: decoded,
      parser: 'yaml',
      kind: 'yaml.quoted',
    });
  }

  const lineRe = /^(\s*(?:-\s*)?[^#\n:]+:\s*)([^#\n]+)$/gm;
  while ((match = lineRe.exec(text))) {
    const value = match[2].trim();
    if (!looksPathLike(value) || value.includes(' ')) continue;
    const leading = match[2].indexOf(value);
    const start = match.index + match[1].length + leading;
    candidates.push({
      start,
      end: start + value.length,
      raw: value,
      parser: 'yaml',
      kind: 'yaml.scalar',
    });
  }

  return candidates;
}

function extractNotebookCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let notebook: unknown;
  try {
    notebook = JSON.parse(text);
  } catch {
    return candidates;
  }
  if (!notebook || typeof notebook !== 'object' || !Array.isArray((notebook as { cells?: unknown }).cells)) return candidates;

  let cursor = 0;
  for (const cell of (notebook as { cells: Array<{ cell_type?: string; source?: unknown }> }).cells) {
    const source = cell.source;
    const sourceLines = Array.isArray(source) ? source.filter((line): line is string => typeof line === 'string') : typeof source === 'string' ? [source] : [];
    for (const line of sourceLines) {
      const encodedLine = JSON.stringify(line);
      const rawLineStart = text.indexOf(encodedLine, cursor);
      if (rawLineStart < 0) continue;
      cursor = rawLineStart + encodedLine.length;
      const rawContentStart = rawLineStart + 1;
      const rawContent = encodedLine.slice(1, -1);
      const lineCandidates =
        cell.cell_type === 'markdown'
          ? extractMarkdownCandidates(line, 0, 'ipynb.markdown-link')
          : extractQuotedPathCandidates(line, 0, 'ipynb.code-string');
      for (const candidate of lineCandidates) {
        const rawStartOffset = decodedIndexToRawOffset(rawContent, candidate.start);
        const rawEndOffset = decodedIndexToRawOffset(rawContent, candidate.end);
        if (rawStartOffset < 0 || rawEndOffset < 0) continue;
        candidates.push({
          ...candidate,
          start: rawContentStart + rawStartOffset,
          end: rawContentStart + rawEndOffset,
          parser: 'ipynb',
        });
      }
    }
  }
  return candidates;
}

function decodedIndexToRawOffset(rawContent: string, decodedIndex: number): number {
  let raw = 0;
  let decoded = 0;
  while (raw <= rawContent.length) {
    if (decoded === decodedIndex) return raw;
    const ch = rawContent[raw];
    if (ch === '\\') {
      const next = rawContent[raw + 1];
      raw += next === 'u' ? 6 : 2;
      decoded += 1;
      continue;
    }
    raw += 1;
    decoded += 1;
  }
  return decoded === decodedIndex ? rawContent.length : -1;
}

function decodeLooseString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/');
}

function looksPathLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 260) return false;
  if (isUrlLike(trimmed) || isAnchorLike(trimmed)) return true;
  if (trimmed.includes('\n')) return false;
  if (/[*?]/.test(trimmed)) return false;
  if (!/[./\\]/.test(trimmed)) return false;
  return /[A-Za-z0-9_\-. /\\]/.test(trimmed);
}

function resolveCandidate(index: ProjectIndex, sourceRel: string, candidate: Candidate): Pick<ReferenceEdge, 'resolution' | 'resolvedTargetRel' | 'reason' | 'preserveExtensionless'> {
  const raw = candidate.raw.trim();
  if (!raw) return { resolution: 'unresolved', reason: 'empty path', preserveExtensionless: false };
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    const abs = path.resolve(raw);
    return {
      resolution: 'absolute',
      reason: isInsideRoot(index.rootPath, abs) ? 'absolute project-local path is reported but not auto-updated in v1' : 'absolute external path',
      preserveExtensionless: false,
    };
  }
  if (isUrlLike(raw) || isAnchorLike(raw)) return { resolution: 'external', reason: 'URL, URI, or anchor reference', preserveExtensionless: false };
  if (hasGlobMagic(raw)) return { resolution: 'unresolved', reason: 'glob-like or dynamic path', preserveExtensionless: false };

  const normalizedRaw = normalizeRel(toPosixPath(raw));
  const rawHadNoExtension = path.posix.extname(normalizedRaw) === '';
  const searchBases = [dirnameRel(sourceRel), ''];
  const extensionCandidates = rawHadNoExtension ? extensionListForKind(candidate.kind) : [''];

  for (const base of searchBases) {
    for (const ext of extensionCandidates) {
      const rel = normalizeRel(path.posix.join(base || '.', `${normalizedRaw}${ext}`));
      if (index.filesByRel[rel]) {
        return {
          resolution: 'resolved',
          resolvedTargetRel: rel,
          preserveExtensionless: rawHadNoExtension && ext !== '',
        };
      }
    }
  }

  return { resolution: 'unresolved', reason: 'path does not resolve to an indexed project file', preserveExtensionless: false };
}

function extensionListForKind(kind: string): string[] {
  const specific = TEX_EXTENSIONS_BY_KIND[kind];
  if (specific) return ['', ...specific];
  return ['', ...GENERIC_EXTENSIONS];
}
