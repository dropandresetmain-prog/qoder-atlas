/**
 * Extract the PRIMARY visible text of a rendered page: everything a user reads
 * without opening a `Technical details` disclosure. Attributes (data-*, title,
 * aria-*), <script>, <style>, <svg> geometry and Technical details are
 * excluded — machine values may live there, never in primary copy.
 */
export function primaryVisibleText(html: string): string {
  let out = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Drop every <details> whose summary says "Technical details" (non-nested in our markup).
  out = out.replace(/<details\b[^>]*>\s*<summary\b[^>]*>(?:(?!<\/summary>)[\s\S])*Technical details(?:(?!<\/summary>)[\s\S])*<\/summary>[\s\S]*?<\/details>/gi, ' ');
  out = out.replace(/<[^>]+>/g, ' ');
  return decodeEntities(out).replace(/\s+/g, ' ').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
}

/** Patterns that mean internal vocabulary leaked into primary copy. */
export const INTERNAL_LANGUAGE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'UPPER_SNAKE enum', pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/ },
  { name: 'snake_case code', pattern: /\b[a-z]+(?:_[a-z0-9]+)+\b/ },
  { name: 'UUID', pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  { name: 'ISO instant', pattern: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ },
  { name: 'typed ref', pattern: /\b[A-Z][A-Z_]{2,}:[\w-]{3,}/ },
  { name: 'CURRENT+PASS', pattern: /CURRENT\s*\+\s*(?:PASS|FAIL)/ },
  { name: 'JOURNEY/TRIP subjects', pattern: /JOURNEY\/TRIP|\bcase JOURNEY\b|\bsubjects\b/i },
  { name: 'machine pair', pattern: /\b[A-Z]{2,}(?:[/+][A-Z]{2,})+\b/ },
  { name: 'projection placeholder', pattern: /postgres|assembled from/i },
  { name: 'undefined/null/[object', pattern: /\bundefined\b|\[object |\bNaN\b/ },
];

export function findInternalLanguage(text: string): string[] {
  const hits: string[] = [];
  for (const { name, pattern } of INTERNAL_LANGUAGE_PATTERNS) {
    const m = pattern.exec(text);
    if (m) hits.push(`${name}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`);
  }
  return hits;
}
