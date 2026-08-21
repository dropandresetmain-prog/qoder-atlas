/**
 * F2 — persistence seams (FR-01, FR-14, ARCHITECTURE.md §16).
 * SQLite implementations live in `src/persistence/` (lane A1); the domain
 * never sees the storage engine.
 */
import type { EntityId, IsoDateTime, SourceKind, SourceRecord } from '../domain/common.ts';
import type { Trip, TripViability } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { TripSignal } from '../operational/signal.ts';

export interface TripSummary {
  tripId: EntityId;
  label?: string;
  travellerIds: EntityId[];
  anchorEventId?: EntityId;
  viability: TripViability;
  updatedAt: IsoDateTime;
}

export interface TripRepository {
  saveTrip(trip: Trip): Promise<void>;
  getTrip(tripId: EntityId): Promise<Trip | undefined>;
  listTrips(): Promise<TripSummary[]>;
}

export interface CaseRepository {
  saveCase(recoveryCase: RecoveryCase): Promise<void>;
  getCase(caseId: EntityId): Promise<RecoveryCase | undefined>;
  listCasesForTrip(tripId: EntityId): Promise<RecoveryCase[]>;
  listOpenCases(): Promise<RecoveryCase[]>;
}

export interface SignalRepository {
  saveSignal(signal: TripSignal): Promise<void>;
  getSignal(signalId: EntityId): Promise<TripSignal | undefined>;
  listSignalsForTrip(tripId: EntityId): Promise<TripSignal[]>;
}

export interface SourceRepository {
  saveSource(source: SourceRecord): Promise<void>;
  getSource(sourceId: EntityId): Promise<SourceRecord | undefined>;
  listSources(kind?: SourceKind): Promise<SourceRecord[]>;
  /** Raw content lives outside trip state; stored/loaded separately. */
  saveSourceContent(sourceId: EntityId, content: string): Promise<void>;
  getSourceContent(sourceId: EntityId): Promise<string | undefined>;
}

export interface AuditEntry {
  occurredAt: IsoDateTime;
  actor: string;
  action: string;
  subject?: EntityId;
  payload: Record<string, unknown>;
}

export interface AuditQuery {
  subject?: EntityId;
  action?: string;
  since?: IsoDateTime;
  limit?: number;
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<void>;
  query(filter: AuditQuery): Promise<AuditEntry[]>;
}
