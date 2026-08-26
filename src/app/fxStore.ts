/**
 * Northstar — application-owned FX rate evidence store (ADR-052).
 *
 * Evidenced FX observations with provenance and an effective period, persisted
 * beside preferences/dossiers in the same SQLite database and re-validated on
 * every read. Scenario bundles may ship an optional `fx-rates.json`; seeding
 * follows the exact dossier discipline: validated payloads only, referential
 * integrity at seed time, no scenario-keyed lookups (the resolver queries by
 * currency pair + instant).
 *
 * Like `dossierStore.ts`, this is deliberately NOT part of the frozen entity
 * registry: market-data evidence is not authoritative graph state.
 */
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { FxRateEvidenceSchema, type FxRateEvidence } from '../engine/fx.ts';

/** Bundle wire shape for `fx-rates.json` inside a scenario directory. */
export const FxRateBundleSchema = z.strictObject({
  rates: z.array(FxRateEvidenceSchema).default([]),
});
export type FxRateBundle = z.infer<typeof FxRateBundleSchema>;

export interface FxRateStore {
  save(rate: FxRateEvidence): Promise<void>;
  /** All stored evidence for one base->home pair (resolver filters by instant). */
  ratesFor(baseCurrency: string, homeCurrency: string): Promise<FxRateEvidence[]>;
}

export class SqliteFxRateStore implements FxRateStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    // Application-owned table; the frozen persistence schema is untouched.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fx_rates (
        base_currency TEXT NOT NULL,
        home_currency TEXT NOT NULL,
        rate_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (rate_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fx_rates_pair ON fx_rates (base_currency, home_currency);
    `);
  }

  async save(rate: FxRateEvidence): Promise<void> {
    const validated = FxRateEvidenceSchema.parse(rate);
    this.db
      .prepare(
        `INSERT INTO fx_rates (base_currency, home_currency, rate_id, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(rate_id) DO UPDATE SET data = excluded.data`,
      )
      .run(validated.baseCurrency, validated.homeCurrency, validated.id, JSON.stringify(validated));
  }

  async ratesFor(baseCurrency: string, homeCurrency: string): Promise<FxRateEvidence[]> {
    const rows = this.db
      .prepare(
        'SELECT data FROM fx_rates WHERE base_currency = ? AND home_currency = ? ORDER BY rate_id',
      )
      .all(baseCurrency, homeCurrency) as Array<{ data: string }>;
    return rows.map((row) => FxRateEvidenceSchema.parse(JSON.parse(row.data)));
  }
}
