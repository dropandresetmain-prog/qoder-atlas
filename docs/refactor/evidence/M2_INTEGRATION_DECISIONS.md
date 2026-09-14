# M2 integration decisions (promotion onto `data-structure-refactor`)

Recorded at promotion of accepted `milestone-m2` (`a7d0d768d647ac5705547ecc580e9d02064af12a`)
onto `data-structure-refactor`. Resolves the **Investigate Now** disposition
on gaps **G1** and **G12** from [`M2.md`](M2.md) so M3/M4/M5 lanes have a
settled answer before they branch.

## G1 — read transaction / snapshot consistency

**Gap** (per `M2.md`): `UnitOfWork` exposes no read-only transaction, so read
query classes take an injected `Queryable = Pool | PoolClient` instead of
running inside the command's transaction; a caller can therefore read
outside a snapshot.

**Decision:** No `UnitOfWork` mutation now. The frozen `UnitOfWork` contract
is not changed by this promotion or by M3/M4/M5. **M6** owns the decision
and implementation for snapshot-consistent read transactions /
`WorldSnapshot` capture, at the point where multi-object unified evaluation
actually requires cross-object read consistency.

**How to apply:** M3/M4/M5 continue to use the existing
`Queryable = Pool | PoolClient` read pattern established by M2. Do not add
ad hoc snapshot/read-transaction mechanisms in those lanes; defer to M6.

## G12 — subject-id shape divergence across lanes

**Gap** (per `M2.md`): subject-id shape is validated differently across
lanes — the people lane requires `z.uuid()`; travel and support accept the
frozen `SubjectIdSchema` regex (`^[A-Za-z0-9][A-Za-z0-9_\-:.]*$`), which
legally admits non-UUID legacy-shaped ids (e.g. `trip-legacy-7`,
`journey:7`) that can then reach a typed `uuid` column.

**Decision:**

- At the persistence command boundary — immediately before `UnitOfWork`
  execution — target PostgreSQL domain IDs **must be UUIDs**.
- The broader frozen `SubjectIdSchema` (`identity.ts`) is **not** globally
  narrowed to UUID-only. It continues to legally admit legacy/source-shaped
  identifiers elsewhere in the envelope.
- Legacy/source IDs remain external/migration identifiers. They map to
  target UUIDs; they are not themselves persisted into `uuid` columns.
- **M3/M4/M5 must follow the UUID persistence-boundary rule** above when
  they add their own persistence command boundaries.
- The existing M2 travel/support normalization gap (non-UUID-shaped ids
  reaching typed columns today) is **assigned to the future M2-M5
  integration pass**, not to another M2 lane cycle. M2 source is
  intentionally not modified for G12 as part of this promotion.

**How to apply:** when reviewing M3/M4/M5 persistence command handlers,
require an explicit legacy-id -> UUID mapping step before the command
reaches `UnitOfWork.execute(...)`. Do not accept a lane that validates a
subject id with the frozen `SubjectIdSchema` regex alone and then writes it
directly into a `uuid` column.
