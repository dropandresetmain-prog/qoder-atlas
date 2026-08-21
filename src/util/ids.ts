/** Generic entity identifier helper. No demo/scenario semantics here. */
import { randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
