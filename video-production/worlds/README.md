# Generated-film world state

`connected-programme.js` is the reusable data/layout contract for NORTHSTAR's connected programme world used by Seq05, Seq06 and intended Seq07.

It owns data and geometry, not choreography:

- world dimensions and camera handoffs;
- 72-traveller scale-field layout and differentiated state;
- programme frame, three day territories and commitments;
- purposeful programme dependencies;
- traveller-to-programme dependency assignments;
- detailed hero journeys and structured traveller constraints;
- final NORTHSTAR system-boundary geometry;
- Seq07 baseline version: `seq06-baseline-v1`.

`connected-programme-build.js` turns the data into DOM/SVG objects using shared generic primitives. Sequence timelines remain inside their own sequence directories.
