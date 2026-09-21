/**
 * Progressive-delay timeline helpers shared by the founder-QC CLI and the
 * Demo Console. Stage semantics live in scenario data; this module has no
 * traveller/route application branches.
 */
import { readFileSync } from 'node:fs';

export interface DelayStage {
  id: string;
  at?: string;
  eventId?: string;
  eventType?: string;
  arrTime?: string;
  depTime?: string;
  connectionRemainingMinutes?: number;
  planningNow?: string;
  narrative?: string;
  phase?: string;
}

export interface DelayTimeline {
  flightNo?: string;
  orderNo?: string;
  stages: DelayStage[];
}

export function loadTimeline(path: string): DelayTimeline {
  return JSON.parse(readFileSync(path, 'utf8')) as DelayTimeline;
}

/** Provider-event stages that mutate transport schedule observations. */
export function providerEventStages(timeline: DelayTimeline): DelayStage[] {
  return timeline.stages.filter((stage) => Boolean(stage.eventId && stage.arrTime));
}

/** Clock-only stages — advance the workspace evaluation clock, no provider event. */
export function clockOnlyStages(timeline: DelayTimeline): DelayStage[] {
  return timeline.stages.filter((stage) => Boolean(stage.planningNow) && !stage.eventId);
}

/** Ordered harness-driven stages: provider events, then clock-only advances. */
export function harnessDrivenStages(timeline: DelayTimeline): DelayStage[] {
  return [...providerEventStages(timeline), ...clockOnlyStages(timeline)];
}

export function isProviderEventStage(stage: DelayStage): boolean {
  return Boolean(stage.eventId && stage.arrTime);
}

export function isClockOnlyStage(stage: DelayStage): boolean {
  return Boolean(stage.planningNow) && !stage.eventId;
}

export function findTimelineStage(timeline: DelayTimeline, stageId: string): DelayStage | undefined {
  return harnessDrivenStages(timeline).find((stage) => stage.id === stageId)
    ?? timeline.stages.find((stage) => stage.id === stageId);
}
