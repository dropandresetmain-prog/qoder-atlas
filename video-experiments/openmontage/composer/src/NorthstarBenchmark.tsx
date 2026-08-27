import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  FleetGrid,
  JourneyChain,
  ProgrammeReadout,
  StatusBadge,
  TitleCard,
} from "./components";
import { COLORS, DURATION_FRAMES, clamp01, segmentProgress } from "./theme";

const PHASE = {
  healthyEnd: 75, // 2.5s
  disruptionEnd: 150, // 5s
  revealEnd: 270, // 9s
  end: DURATION_FRAMES,
};

export const NorthstarBenchmark: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const flightProposed = frame >= 42 && frame < 62;
  const flightSettled = frame >= 62;
  const transferBroken = frame >= 95;
  const keynoteBroken = frame >= 110;

  const revealT = segmentProgress(frame, 150, 255);
  const worldScale = interpolate(revealT, [0, 1], [1, 0.34]);
  const worldY = interpolate(revealT, [0, 1], [0, -120]);

  const blastT = segmentProgress(frame, 270, 300);
  const settle = spring({
    frame: frame - 270,
    fps,
    config: { damping: 18, stiffness: 90 },
  });

  const showTripNotRecovered = frame >= 118 && frame < 150;
  const tripBannerOpacity = interpolate(
    frame,
    [118, 130, 145, 150],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const journeys = [
    { x: -220, y: 40, delay: 0.15 },
    { x: 0, y: -10, delay: 0.28 },
    { x: 220, y: 50, delay: 0.4 },
  ];

  const travellerMarks = Array.from({ length: 18 }, (_, i) => ({
    x: -360 + (i % 6) * 120,
    y: 120 + Math.floor(i / 6) * 70,
    tone: i % 7 === 0 ? "alert" : i % 5 === 0 ? "watch" : "ok",
    delay: 0.45 + i * 0.02,
  })) as const;

  const blastOutcomes = [
    { label: "✓ RECOVERED", tone: "ok" as const, x: -260, y: 120 },
    { label: "▲ AT RISK", tone: "watch" as const, x: 0, y: 170 },
    { label: "✕ NOT VIABLE", tone: "alert" as const, x: 260, y: 120 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${worldY}px) scale(${worldScale})`,
          transformOrigin: "50% 42%",
        }}
      >
        {/* Phase 1-2: hero journey */}
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <JourneyChain
            x={width / 2}
            y={height * 0.38}
            flightState={
              flightSettled ? "healthy" : flightProposed ? "proposed" : "healthy"
            }
            transferState={transferBroken ? "broken" : "healthy"}
            hotelState={transferBroken ? "broken" : "healthy"}
            keynoteState={keynoteBroken ? "broken" : "healthy"}
            showRebooked={flightProposed}
            opacity={interpolate(frame, [0, 12], [0, 1], {
              extrapolateRight: "clamp",
            })}
          />

          {revealT > 0.12 &&
            journeys.map((j, idx) => {
              const t = segmentProgress(frame, 150 + j.delay * 90, 240);
              return (
                <JourneyChain
                  key={idx}
                  x={width / 2 + j.x * revealT}
                  y={height * 0.38 + j.y * revealT}
                  scale={0.72}
                  flightState="healthy"
                  transferState={idx === 1 ? "broken" : "healthy"}
                  hotelState="healthy"
                  keynoteState={idx === 1 ? "broken" : "healthy"}
                  opacity={t}
                />
              );
            })}

          {revealT > 0.45 && (
            <FleetGrid
              x={width / 2}
              y={height * 0.62}
              cols={14}
              rows={5}
              cell={12}
              gap={5}
              seed={3}
              opacity={segmentProgress(frame, 210, 250) * 0.95}
            />
          )}

          {revealT > 0.62 && (
            <ProgrammeReadout
              x={width / 2}
              y={height * 0.78}
              scale={0.9 + revealT * 0.15}
              opacity={segmentProgress(frame, 230, 265)}
            />
          )}

          {frame >= 270 && (
            <>
              <circle
                cx={width / 2}
                cy={height * 0.42}
                r={40 + blastT * 180}
                fill="none"
                stroke={COLORS.brass}
                strokeWidth={2}
                opacity={0.35 * (1 - blastT * 0.5)}
              />
              <circle
                cx={width / 2}
                cy={height * 0.42}
                r={20 + blastT * 90}
                fill="none"
                stroke={COLORS.vermilion}
                strokeWidth={2}
                opacity={0.5 * (1 - blastT * 0.3)}
              />
            </>
          )}
        </svg>

        {showTripNotRecovered && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "58%",
              transform: "translateX(-50%)",
              opacity: tripBannerOpacity,
            }}
          >
            <StatusBadge label="TRIP NOT RECOVERED" tone="alert" />
          </div>
        )}

        {frame >= 118 && frame < 150 && (
          <div
            style={{
              position: "absolute",
              right: 120,
              top: height * 0.34,
              opacity: interpolate(frame, [118, 130], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            <StatusBadge label="REBOOKED ✓" tone="ok" />
          </div>
        )}

        {frame >= 270 &&
          travellerMarks.slice(0, 9).map((mark, i) => {
            const t = segmentProgress(frame, 280 + i * 2, 310);
            const outcome = blastOutcomes[i % 3];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: width / 2 + mark.x * 0.55,
                  top: height * 0.5 + mark.y * 0.35,
                  opacity: t,
                  transform: `translate(-50%, -50%) scale(${0.85 + t * 0.15})`,
                }}
              >
                <StatusBadge
                  label={outcome.label}
                  tone={outcome.tone}
                  size="sm"
                />
              </div>
            );
          })}
      </div>

      {frame >= 285 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 72,
            opacity: clamp01(settle),
            transform: `translateY(${(1 - settle) * 24}px)`,
          }}
        >
          <TitleCard title="Live Dependency Graph" subtitle="Blast radius · programme scale" />
        </div>
      )}
    </AbsoluteFill>
  );
};
