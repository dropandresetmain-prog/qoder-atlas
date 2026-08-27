export const COLORS = {
  bg: "#F2F4F5",
  surface: "#FFFFFF",
  surface2: "#F8F9FA",
  ink: "#14171C",
  line: "rgba(20,23,28,0.13)",
  green: "#4C9A6E",
  greenText: "#2F6B47",
  brass: "#D9A24A",
  brassText: "#96670F",
  vermilion: "#E0521F",
  vermilionText: "#C2431A",
  grey: "#C6CBD2",
  greyText: "#6B7280",
} as const;

export const FPS = 30;
export const DURATION_SECONDS = 12;
export const DURATION_FRAMES = FPS * DURATION_SECONDS;

export type LinkState = "healthy" | "proposed" | "broken" | "unknown";

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function segmentProgress(
  frame: number,
  start: number,
  end: number,
): number {
  if (frame <= start) return 0;
  if (frame >= end) return 1;
  return easeOutCubic((frame - start) / (end - start));
}
