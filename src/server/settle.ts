/**
 * Wave 3 product convergence — server-side settle marking (DESIGN.md §6.1).
 *
 * Kimi's motion charter: "when a value changes — a count, a status, a cell in
 * the fleet grid — it settles. Triggered by adding `.just-changed` to the
 * element (integrator adds it server-side when a re-render carries a changed
 * value)." The renderers are pure functions of read models and take no change
 * flags, so the diff happens here at the HTTP seam: a per-server tracker
 * remembers the last rendered value per surface key, and when a re-render
 * carries a different value the corresponding element (located by a stable
 * data-attribute/substring marker the renderers already emit) gets the
 * `just-changed` class added to its tag. No change → no class → no fake
 * animation; first render never marks anything (nothing changed yet).
 */

/** Tracks last-rendered values per surface key for one server instance. */
export class SettleTracker {
  private last = new Map<string, string>();

  /**
   * Record the current values and return the keys whose value differs from
   * the previous render of the same surface. Keys not present before are
   * treated as unchanged (first render never settles).
   */
  diffAndRecord(values: ReadonlyMap<string, string>): string[] {
    const changed: string[] = [];
    for (const [key, value] of values) {
      const previous = this.last.get(key);
      if (previous !== undefined && previous !== value) changed.push(key);
    }
    for (const [key, value] of values) this.last.set(key, value);
    return changed;
  }

  /** Forget everything rendered before (demo reset starts a clean board). */
  reset(): void {
    this.last.clear();
  }
}

/**
 * Add a class to every opening tag that contains `marker`. The marker is a
 * stable substring the renderer emits (e.g. `data-trip-id="trip_a"`); a trip
 * can appear in several elements on one surface (fleet cell + roster row),
 * so all matches settle together. Tags without a class attribute are left
 * untouched — the class is decorative.
 */
export function addClassToTagsContaining(html: string, marker: string, className: string): string {
  let result = '';
  let cursor = 0;
  for (;;) {
    const markerIndex = html.indexOf(marker, cursor);
    if (markerIndex === -1) {
      result += html.slice(cursor);
      return result;
    }
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
