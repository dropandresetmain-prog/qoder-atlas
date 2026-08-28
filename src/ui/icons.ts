/**
 * Shared solid icon vocabulary for Northstar screens.
 *
 * Every icon is a compact inline SVG that fills with `currentColor`, so the
 * surrounding state colour (green/amber/red/grey) always drives the fill.
 * Icons are solid silhouettes — readable at mini-chain size, never hollow
 * outlines, never emoji, never a generic square.
 *
 * Two families:
 * - TYPE icons: journey-chain element kinds (flight, ground, stay, commitment)
 *   shared by the Overview mini-chain, the case trip chain, the traveller
 *   itinerary, and any legend that maps the same element types.
 * - STEP icons: semantic lifecycle categories for progress overlays
 *   (action/execution, provider confirmation, trip/state update,
 *   validation/recheck, completion, plus analysis phases).
 */

const SVG_OPEN = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">';

function svg(path: string): string {
  return `${SVG_OPEN}${path}</svg>`;
}

/** Solid aircraft silhouette. */
export const ICON_FLIGHT = svg(
  '<path d="M8 .8l1.6 5.6 5.9 2.6v1.6l-5.9-1v3.6l2.1 1.6v1.4L8 15l-3.7 1.2v-1.4l2.1-1.6V9.6l-5.9 1V9l5.9-2.6L8 .8z"/>',
);

/** Opposing arrows — ground movement / connection between legs. */
export const ICON_GROUND = svg(
  '<path d="M2 4.6h8V2.4l4 3.3-4 3.3V6.8H2V4.6z"/><path d="M14 11.4H6v2.2l-4-3.3 4-3.3v2.2h8v2.2z"/>',
);

/**
 * Solid hotel building: filled block with window and door openings.
 * Reads as hotel/building even at 12–14px; the state colour fills it.
 */
export const ICON_HOTEL = svg(
  '<path fill-rule="evenodd" d="M3 1.5h10V14h2v1.6H1V14h2V1.5zm2 2.3h2v2H5v-2zm4 0h2v2H9v-2zM5 7.6h2v2H5v-2zm4 0h2v2H9v-2zm-2 3.8h2v2.6H7v-2.6z"/>',
);

/** Solid four-point star — the programme commitment. */
export const ICON_COMMITMENT = svg(
  '<path d="M8 .4l1.9 5.7L15.6 8l-5.7 1.9L8 15.6 6.1 9.9.4 8l5.7-1.9L8 .4z"/>',
);

/** Send arrow for the chat composer. */
export const ICON_SEND = svg('<path d="M8 1.6l5.4 6h-3.2V14H5.8V7.6H2.6L8 1.6z"/>');

// ---------------------------------------------------------------------------
// Semantic step categories (progress overlays)
// ---------------------------------------------------------------------------

/** Action / execution — applying an approved change. */
export const ICON_EXECUTE = svg('<path d="M9.3.8L2.8 9h4l-1.1 6.2L12.2 7H8.2l1.1-6.2z"/>');

/** Provider confirmation — booking document with settled lines. */
export const ICON_PROVIDER = svg(
  '<path fill-rule="evenodd" d="M3.2 1h9.6v14l-1.6-1.2-1.6 1.2-1.6-1.2L6.4 15l-1.6-1.2L3.2 15V1zm2 3h5.6v1.4H5.2V4zm0 2.9h5.6v1.4H5.2V6.9zm0 2.9h3.6v1.4H5.2V9.8z"/>',
);

/** Trip / state update — the journey record. */
export const ICON_TRIP_UPDATE = svg(
  '<path fill-rule="evenodd" d="M8 .8a5.2 5.2 0 015.2 5.2C13.2 9.6 8 15.2 8 15.2S2.8 9.6 2.8 6A5.2 5.2 0 018 .8zm0 3.1a2.1 2.1 0 100 4.2 2.1 2.1 0 000-4.2z"/>',
);

/** Validation / recheck — shield with a check. */
export const ICON_RECHECK = svg(
  '<path fill-rule="evenodd" d="M8 .6l6.2 2.1v4.7c0 3.7-2.7 6.7-6.2 7.9-3.5-1.2-6.2-4.2-6.2-7.9V2.7L8 .6zm2.9 4.5L7.1 8.9 5.2 7l-1 1 2.9 2.9 4.8-4.8-1-1z"/>',
);

/** Completion — solid check roundel. */
export const ICON_COMPLETE = svg(
  '<path fill-rule="evenodd" d="M8 .8a7.2 7.2 0 110 14.4A7.2 7.2 0 018 .8zM6.7 10.6L4.4 8.3l-1 1 3.3 3.3 4.9-4.9-1-1-3.9 3.9z"/>',
);

/** Linked travellers — two people. */
export const ICON_TRAVELLERS = svg(
  '<path d="M5.6 1.8a2.6 2.6 0 110 5.2 2.6 2.6 0 010-5.2zM.8 13.4c0-2.6 2.1-4.2 4.8-4.2s4.8 1.6 4.8 4.2v1.2H.8v-1.2z"/><path d="M11.2 2.6a2.1 2.1 0 110 4.2 2.1 2.1 0 010-4.2zm-1 6.4c.3-.1.7-.1 1-.1 2.3 0 4.2 1.4 4.2 3.7v1.2h-4.1v-1c0-1.4-.4-2.7-1.1-3.8z"/>',
);

/** Programme time — clock face. */
export const ICON_TIME = svg(
  '<path fill-rule="evenodd" d="M8 .8a7.2 7.2 0 110 14.4A7.2 7.2 0 018 .8zm.9 2.9H7.1v4.9l3.8 2.3.9-1.4-2.9-1.8V3.7z"/>',
);

/** Knock-on effects / impact — alert mark. */
export const ICON_IMPACT = svg(
  '<path fill-rule="evenodd" d="M8 .6l7.6 13.6H.4L8 .6zm-.9 4.6h1.8l-.3 4.4H7.4l-.3-4.4zm.9 5.8a1 1 0 110 2 1 1 0 010-2z"/>',
);

/** Searching options — magnifier. */
export const ICON_SEARCH = svg(
  '<path fill-rule="evenodd" d="M6.6.8a5.8 5.8 0 014.6 9.3l4.2 4.3-1.3 1.3-4.2-4.3A5.8 5.8 0 116.6.8zm0 2.1a3.7 3.7 0 100 7.4 3.7 3.7 0 000-7.4z"/>',
);

/** Authority — plain shield. */
export const ICON_AUTHORITY = svg(
  '<path d="M8 .6l6.2 2.1v4.7c0 3.7-2.7 6.7-6.2 7.9-3.5-1.2-6.2-4.2-6.2-7.9V2.7L8 .6z"/>',
);

/** Entry requirements — document. */
export const ICON_ENTRY = svg(
  '<path fill-rule="evenodd" d="M3 1h7l3 3v11H3V1zm7 1.4V5h2.6L10 2.4zM5.2 7h5.6v1.3H5.2V7zm0 2.5h5.6v1.3H5.2V9.5zM5.2 12h3.6v1.3H5.2V12z"/>',
);

/** Insurance coverage — umbrella. */
export const ICON_INSURANCE = svg(
  '<path fill-rule="evenodd" d="M8 .6a7.4 7.4 0 017.4 7.4H.6A7.4 7.4 0 018 .6zm-.8 7.4h1.6v5.4a1.6 1.6 0 01-3.2 0h1.6v-5.4z"/>',
);

/** Cost — price tag. */
export const ICON_COST = svg(
  '<path fill-rule="evenodd" d="M1 1h6.8l7.2 7.2-6.6 6.6L1.2 7.6V1zm3.1 1.9a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z"/>',
);

/**
 * Type icon per journey-chain element kind. Colour communicates state via the
 * surrounding tone class; the glyph communicates the element type.
 */
export const CHAIN_TYPE_SVG: Record<'FLIGHT' | 'GROUND' | 'STAY' | 'COMMITMENT', string> = {
  FLIGHT: ICON_FLIGHT,
  GROUND: ICON_GROUND,
  STAY: ICON_HOTEL,
  COMMITMENT: ICON_COMMITMENT,
};

/**
 * Semantic step icons keyed by lifecycle category. Progress overlays pick one
 * per phase; categories map to the concepts the phases describe.
 */
export const STEP_ICON_SVG: Record<string, string> = {
  execute: ICON_EXECUTE,
  provider: ICON_PROVIDER,
  trip_update: ICON_TRIP_UPDATE,
  recheck: ICON_RECHECK,
  complete: ICON_COMPLETE,
  travellers: ICON_TRAVELLERS,
  time: ICON_TIME,
  impact: ICON_IMPACT,
  search: ICON_SEARCH,
  authority: ICON_AUTHORITY,
  entry: ICON_ENTRY,
  insurance: ICON_INSURANCE,
  cost: ICON_COST,
  flight: ICON_FLIGHT,
  ground: ICON_GROUND,
  stay: ICON_HOTEL,
  commitment: ICON_COMMITMENT,
};
