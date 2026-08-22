/**
 * Test helper types for the minimal XLSX builder.
 */
export interface XlsxBuildOptions {
  /** First worksheet row; used as headers. */
  headers: string[];
  /** Subsequent worksheet rows. */
  rows: string[][];
}
