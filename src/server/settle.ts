/**
 * Tracks rendered values so the UI marks only real state transitions.
 * First renders never settle, and unchanged re-renders stay unmarked.
 */
export class SettleTracker {
  private last = new Map<string, string>();

  diffAndRecord(values: ReadonlyMap<string, string>): string[] {
    const changed: string[] = [];
    for (const [key, value] of values) {
      const previous = this.last.get(key);
      if (previous !== undefined && previous !== value) changed.push(key);
    }
    for (const [key, value] of values) this.last.set(key, value);
    return changed;
  }

  reset(): void {
    this.last.clear();
  }
}

/** Add a decorative class to each rendered tag containing a stable marker. */
export function addClassToTagsContaining(html: string, marker: string, className: string): string {
  let result = '';
  let cursor = 0;
  for (;;) {
    const markerIndex = html.indexOf(marker, cursor);
    if (markerIndex === -1) return result + html.slice(cursor);
    const tagStart = html.lastIndexOf('<', markerIndex);
    const tagEnd = html.indexOf('>', markerIndex);
    if (tagStart === -1 || tagEnd === -1 || tagEnd < tagStart || tagStart < cursor) {
      result += html.slice(cursor, markerIndex + marker.length);
      cursor = markerIndex + marker.length;
      continue;
    }
    result += html.slice(cursor, tagStart);
    const tag = html.slice(tagStart, tagEnd + 1);
    result += tag.includes('class="')
      ? tag.replace('class="', `class="${className} `)
      : tag;
    cursor = tagEnd + 1;
  }
}
