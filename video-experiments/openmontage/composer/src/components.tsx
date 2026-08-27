import React from "react";
import { COLORS } from "./theme";

const mono = '"SF Mono", "Cascadia Code", Consolas, monospace';
const sans = '"Segoe UI", system-ui, -apple-system, sans-serif';

export const StatusBadge: React.FC<{
  label: string;
  tone: "ok" | "watch" | "alert" | "neutral";
  size?: "sm" | "md";
}> = ({ label, tone, size = "md" }) => {
  const palette = {
    ok: { bg: "rgba(76,154,110,0.12)", color: COLORS.greenText, border: COLORS.green },
    watch: { bg: "rgba(217,162,74,0.14)", color: COLORS.brassText, border: COLORS.brass },
    alert: { bg: "rgba(224,82,31,0.12)", color: COLORS.vermilionText, border: COLORS.vermilion },
    neutral: { bg: "rgba(107,114,128,0.12)", color: COLORS.greyText, border: COLORS.grey },
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: size === "sm" ? "4px 8px" : "6px 12px",
        borderRadius: 6,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.color,
        fontFamily: mono,
        fontSize: size === "sm" ? 10 : 12,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
};

export const JourneyChain: React.FC<{
  x: number;
  y: number;
  scale?: number;
  flightState: "healthy" | "proposed";
  transferState: "healthy" | "broken";
  hotelState: "healthy" | "broken";
  keynoteState: "healthy" | "broken";
  showRebooked?: boolean;
  opacity?: number;
}> = ({
  x,
  y,
  scale = 1,
  flightState,
  transferState,
  hotelState,
  keynoteState,
  showRebooked = false,
  opacity = 1,
}) => {
  const linkColor = (state: "healthy" | "proposed" | "broken") => {
    if (state === "healthy") return COLORS.green;
    if (state === "proposed") return COLORS.brass;
    return COLORS.vermilion;
  };

  const nodes = [
    { label: "FLIGHT", state: flightState },
    { label: "TRANSFER", state: transferState },
    { label: "HOTEL", state: hotelState },
    { label: "✦ KEYNOTE", state: keynoteState, commitment: true },
  ];

  const nodeW = 118;
  const gap = 34;
  const totalW = nodes.length * nodeW + (nodes.length - 1) * gap;

  return (
    <g transform={`translate(${x - totalW / 2}, ${y}) scale(${scale})`} opacity={opacity}>
      {nodes.map((node, i) => {
        const left = i * (nodeW + gap);
        const color = linkColor(node.state);
        return (
          <g key={node.label}>
            {i > 0 && (
              <line
                x1={left - gap}
                y1={28}
                x2={left}
                y2={28}
                stroke={color}
                strokeWidth={3}
                strokeDasharray={node.state === "proposed" ? "6 5" : undefined}
              />
            )}
            <rect
              x={left}
              y={0}
              width={nodeW}
              height={56}
              rx={8}
              fill={COLORS.surface}
              stroke={color}
              strokeWidth={2}
            />
            <text
              x={left + nodeW / 2}
              y={node.commitment ? 24 : 28}
              textAnchor="middle"
              fill={COLORS.ink}
              fontFamily={mono}
              fontSize={11}
              fontWeight={600}
              letterSpacing="0.06em"
            >
              {node.label}
            </text>
            {node.commitment && (
              <text
                x={left + nodeW / 2}
                y={42}
                textAnchor="middle"
                fill={color}
                fontFamily={mono}
                fontSize={9}
                fontWeight={600}
              >
                COMMITMENT
              </text>
            )}
          </g>
        );
      })}
      {showRebooked && (
        <foreignObject x={8} y={68} width={140} height={30}>
          <div xmlns="http://www.w3.org/1999/xhtml">
            <StatusBadge label="REBOOKED ✓" tone="ok" size="sm" />
          </div>
        </foreignObject>
      )}
    </g>
  );
};

export const FleetGrid: React.FC<{
  x: number;
  y: number;
  cols: number;
  rows: number;
  cell: number;
  gap: number;
  seed: number;
  opacity?: number;
}> = ({ x, y, cols, rows, cell, gap, seed, opacity = 1 }) => {
  const tones = [COLORS.green, COLORS.brass, COLORS.vermilion, COLORS.grey, COLORS.ink];
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c + seed) % tones.length;
      const tone = idx === 0 || idx === 1 ? COLORS.green : tones[idx % tones.length];
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (cell + gap)}
          y={r * (cell + gap)}
          width={cell}
          height={cell}
          rx={2}
          fill={tone}
          opacity={0.9}
        />,
      );
    }
  }
  const w = cols * cell + (cols - 1) * gap;
  const h = rows * cell + (rows - 1) * gap;
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`} opacity={opacity}>
      {cells}
    </g>
  );
};

export const ProgrammeReadout: React.FC<{
  x: number;
  y: number;
  scale?: number;
  opacity?: number;
}> = ({ x, y, scale = 1, opacity = 1 }) => (
  <g transform={`translate(${x}, ${y}) scale(${scale})`} opacity={opacity}>
    <rect x={-150} y={-48} width={300} height={96} rx={12} fill={COLORS.ink} />
    <text
      x={0}
      y={-10}
      textAnchor="middle"
      fill={COLORS.surface}
      fontFamily={sans}
      fontSize={22}
      fontWeight={700}
    >
      AiT 2026
    </text>
    <text
      x={0}
      y={18}
      textAnchor="middle"
      fill="rgba(255,255,255,0.78)"
      fontFamily={mono}
      fontSize={11}
      fontWeight={600}
      letterSpacing="0.08em"
    >
      67 PARTICIPANTS · 42 MANAGED
    </text>
  </g>
);

export const TitleCard: React.FC<{
  title: string;
  subtitle?: string;
  opacity?: number;
}> = ({ title, subtitle, opacity = 1 }) => (
  <div
    style={{
      opacity,
      textAlign: "center",
      color: COLORS.ink,
      fontFamily: sans,
    }}
  >
    <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</div>
    {subtitle && (
      <div
        style={{
          marginTop: 10,
          fontFamily: mono,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: COLORS.greyText,
        }}
      >
        {subtitle}
      </div>
    )}
  </div>
);
