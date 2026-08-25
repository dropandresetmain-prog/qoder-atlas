/**
 * C1 — recording sanitization (FR-15). Secrets and unsafe PII must be removed
 * from raw provider payloads before they are persisted for replay. The
 * replacement preserves provider shape so recordings still exercise the real
 * normalizer.
 */
export const REDACTED = '[REDACTED]';

/** Keys whose values are treated as credentials or unsafe PII when present. */
const SENSITIVE_KEY_PATTERN =
  /(^|[_\-.])(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?key|token|password|credential|authorization|card[_-]?number|pan|cvv|cvc|passport|email|phone|ssn|national[_-]?id)([_\-.]|$)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

export function sanitizeRaw(raw: unknown, secrets: ReadonlyArray<string> = []): unknown {
  const afterSecrets = redactSecretSubstrings(raw, secrets);
  return redactSensitiveTree(afterSecrets);
}

export function containsAnySecret(value: unknown, secrets: ReadonlyArray<string>): boolean {
  const text = JSON.stringify(value);
  if (text === undefined) return false;
  return secrets.some((secret) => secret.length > 0 && text.includes(secret));
}

/** True when residual secret-shaped or PII-shaped material remains. */
export function containsUnsafeMaterial(value: unknown, secrets: ReadonlyArray<string> = []): boolean {
  if (containsAnySecret(value, secrets)) return true;
  return scanUnsafe(value);
}

function redactSecretSubstrings(raw: unknown, secrets: ReadonlyArray<string>): unknown {
  const nonEmpty = secrets.filter((secret) => secret.length > 0);
  if (nonEmpty.length === 0) return raw;
  const text = JSON.stringify(raw);
  // JSON.stringify(undefined) is undefined (e.g. a GET step has no request
  // body); nothing to redact in a non-serializable value.
  if (text === undefined) return raw;
  let redacted = text;
  for (const secret of nonEmpty) {
    redacted = redacted.split(secret).join(REDACTED);
  }
  return JSON.parse(redacted) as unknown;
}

function redactSensitiveTree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveTree);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof child === 'string' && child.length > 0) {
        out[key] = REDACTED;
      } else {
        out[key] = redactSensitiveTree(child);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.replace(EMAIL_PATTERN, REDACTED).replace(CARD_PATTERN, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 ? REDACTED : match;
    });
  }
  return value;
}

function scanUnsafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(scanUnsafe);
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof child === 'string' && child.length > 0 && child !== REDACTED) {
        return true;
      }
      if (scanUnsafe(child)) return true;
    }
    return false;
  }
  if (typeof value === 'string') {
    if (EMAIL_PATTERN.test(value)) return true;
    EMAIL_PATTERN.lastIndex = 0;
    const card = value.match(CARD_PATTERN);
    if (card?.some((m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19;
    })) {
      return true;
    }
  }
  return false;
}
