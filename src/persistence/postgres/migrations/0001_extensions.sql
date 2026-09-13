-- M1 foundation: required extensions.
-- pgcrypto: gen_random_uuid() for domain identity generation.
-- postgis: geographic applicability (F02); required now so M4's area/geometry
-- migrations (0050-0069) never have to re-derive extension ownership.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
