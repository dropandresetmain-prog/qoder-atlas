/**
 * C1 — recording sanitization (FR-15). Secrets must be removed from raw
 * provider payloads before they are persisted for replay. The replacement is
 * a textual redaction of known secret values: provider shape is preserved so
 * recordings still exercise the real normalizer.
 */

export const REDACTED = '[REDACTED]';

export function sanitizeRaw(raw: unknown, secrets: ReadonlyArray<string>): unknown {
  const nonEmpty = secrets.filter((secret) => secret.length > 0);
  if (nonEmpty.length === 0) return raw;
  let text = JSON.stringify(raw);
  for (const secret of nonEmpty) {
    text = text.split(secret).join(REDACTED);
  }
  return JSON.parse(text) as unknown;
}

export function containsAnySecret(value: unknown, secrets: ReadonlyArray<string>): boolean {
  const text = JSON.stringify(value);
  return secrets.some((secret) => secret.length > 0 && text.includes(secret));
}
