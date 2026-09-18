/**
 * Presentation-only: `insufficient_arrival_readiness` / `TRANSPORT_SCHEDULE_OBSERVED`
 * -> `Insufficient arrival readiness` / `Transport schedule observed`. Generic word
 * splitting of a stable code; it invents no meaning and never replaces the code itself.
 */
export function humanizeCode(code: string): string {
  const words = code.replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return words.length === 0 ? code : words[0]!.toUpperCase() + words.slice(1);
}
