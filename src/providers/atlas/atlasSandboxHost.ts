/**
 * Atlas sandbox host policy shared by the transaction adapter and sandbox-only
 * test-boundary seams (e.g. passenger execution alias).
 */
export const ATLAS_SANDBOX_HOST = 'sandbox.atriptech.com';

/** True only when the base URL's host is unambiguously the Atlas sandbox. */
export function isAtlasSandboxBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === ATLAS_SANDBOX_HOST;
  } catch {
    return false;
  }
}
