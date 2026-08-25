/**
 * Content hashing helpers for acceptance evidence: input-pack versions,
 * reset/reseed checksums, and stable digests of declarative payloads.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { canonicalJson } from '../providers/recordingStore.ts';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Stable hash of every regular file under a directory (path + content). */
export function hashDirectory(root: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const entries: string[] = [];
  walk(root, (absPath) => {
    const rel = relative(root, absPath).replace(/\\/g, '/');
    const content = readFileSync(absPath);
    entries.push(`${rel}:${sha256Hex(content.toString('utf8'))}`);
  });
  entries.sort();
  return sha256Hex(entries.join('\n'));
}

function walk(dir: string, visit: (filePath: string) => void): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, visit);
    else if (st.isFile()) visit(abs);
  }
}

/** Hash of a single file; undefined when missing. */
export function hashFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return sha256Hex(readFileSync(path, 'utf8'));
}
