import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(absPath: string): Promise<string> {
  const buffer = await fs.readFile(absPath);
  return createHash('sha256').update(buffer).digest('hex');
}
