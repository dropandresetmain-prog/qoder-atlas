-- M4 brief §D: "Where a Participation references a Traveller/Journey, enforce
-- consistency." M2's `engagement_item_details.participation_id` (0023) is the
-- only place a Journey references a Participation; M2's own migrations and
-- command handlers are never edited (M4 brief "Never edit M2 migrations"), so
-- this additive M4 migration adds the cross-table backstop the same way 0025
-- backstops F06 credential ownership: a deferred constraint trigger that fires
-- at COMMIT alongside 0061's newly-closed `engagement_item_details_participation_fk`.
--
-- A mismatch is rejected as a Postgres exception (SQLSTATE P0001), which the
-- existing command-handler `databaseConflict()` mapper (both M2's
-- travelCommands.ts and this lane's programmeCommands.ts) already turns into a
-- typed VALIDATION_FAILED conflict — no application-layer change required for
-- either lane to benefit from this guard.

CREATE FUNCTION assert_engagement_participation_traveller_match() RETURNS trigger AS $$
DECLARE
  v_participation_traveller uuid;
  v_journey_traveller uuid;
BEGIN
  IF NEW.participation_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT traveller_id INTO v_participation_traveller
    FROM participations
   WHERE workspace_id = NEW.workspace_id AND id = NEW.participation_id;
  SELECT j.traveller_id INTO v_journey_traveller
    FROM journey_items ji
    JOIN journeys j ON j.workspace_id = ji.workspace_id AND j.id = ji.journey_id
   WHERE ji.workspace_id = NEW.workspace_id AND ji.id = NEW.journey_item_id;
  IF v_participation_traveller IS NOT NULL AND v_journey_traveller IS NOT NULL
     AND v_participation_traveller <> v_journey_traveller THEN
    RAISE EXCEPTION
      'engagement_item_details % participation % traveller % does not match journey traveller % (M4 §D consistency)',
      NEW.journey_item_id, NEW.participation_id, v_participation_traveller, v_journey_traveller;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER engagement_item_details_participation_traveller_assert
  AFTER INSERT OR UPDATE ON engagement_item_details
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_engagement_participation_traveller_match();
