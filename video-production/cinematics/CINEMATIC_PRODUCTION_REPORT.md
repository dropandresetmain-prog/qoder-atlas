# NORTHSTAR cinematic production report

Date: 2026-08-28
Scope: real-world opening and closing-expansion footage only. NORTHSTAR's graph,
product and lockup worlds remain intentionally out of scope.

## Result

**PASS.** The lane delivers a silent 11-second opening, three clean closing
selects and a 9.6-second recommended expansion montage. Every output is H.264,
1920 x 1080, 30fps and yuv420p. Render files and source media stay local and
ignored; scripts and this decision log are versioned.

| Deliverable | Duration | Editorial purpose |
| --- | ---: | --- |
| `render/seq01-02-cinematic-opener.mp4` | 11.00s | one human disruption -> connection, stay and commitment consequences |
| `render/closing/sports.mp4` | 4.00s | organised sport at event scale |
| `render/closing/offsite.mp4` | 4.00s | shared professional arrival at a destination |
| `render/closing/operations.mp4` | 4.00s | calm travel-operations coordination |
| `render/closing-cinematic-expansion.mp4` | 9.60s | recommended sport -> offsite -> operations expansion edit |

## Final editorial decisions

### Opening

The prior stock-only edit was technically sound but began too literally on an
airport board and included a branded curb-side shot. The final edit starts on a
quiet human recognition moment, then cuts only when a new consequence appears:

1. **0.00-3.70:** traveller receives/absorbs the changed state.
2. **3.70-5.10:** passenger movement makes the connection a constrained system,
   not a private inconvenience.
3. **5.10-6.90:** unoccupied hotel environment implies a reservation now
   dependent on timing.
4. **6.90-11.00:** prepared conference room holds longest, landing the
   commitment that the journey must still serve.

The edit deliberately omits a literal transfer insert. The available clip had
branding and added a second generic airport image, while the narration already
supplies that dependency. The final conference-room frame fades into the
NORTHSTAR `#F2F4F5` cockpit-daylight neutral, giving the system-world sequence a
clean place to begin without adding product graphics.

### Closing

The montage expands by *operating context*, not by re-showing another
conference: event-scale sport -> a group journey with a shared destination -> a
team coordinating many journeys. Hard cuts make the repeated underlying problem
feel more important than visual effect. The final operations frame fades to the
same light neutral, intended to hand back to the HTML graph/lockup lane.

Recommended placement: use the 9.6-second montage under the list ending
`travel teams and TMCs`; then let the HTML lane own the final two thesis lines
and NORTHSTAR lockup. If the final assembly needs a different cadence, use the
three clean selects rather than rebuilding from raw sources.

## Wan generation decision log

The allowance was treated as a four-shot ceiling, not an excuse to generate
coverage. One initial operations submission returned no task and did not create
a generation; it was retried once successfully. No variants were generated.

| Section | Generation | Storytelling problem / why stock was insufficient | Prompt approach | Result / final use |
| --- | --- | --- | --- | --- |
| Opening | 1 / 2 | Establish a human state change without a readable airport board or melodrama. The inherited result was already available locally through Model Studio, while the stock anchor was too literal. | Pre-existing prompt was not persisted in this lane; its visual approach is a daylight traveller quietly checking a phone amid terminal movement. | Good, but wider and more generic than the second result. Kept as a local alternate; **not in final cut**. |
| Opening | 2 / 2 | A close human anchor with clean terminal geometry was still needed to lead naturally into the system world. Stock could show airports but not this precise, restrained recognition beat. | Single observational daylight terminal shot: traveller pauses over an implied schedule change, no readable screens, no brands or panic; end with light architectural negative space. | **Used** for 0.00-3.70 of the opener. |
| Closing | 1 / 2 | Show a corporate offsite as shared travel toward a purpose, without fake team-building or tourism-commercial stock. | Observational group arrival at a modern coastal retreat hotel with modest luggage; no posed interaction, signage or brand marks. | **Used** as the offsite clean select and middle montage beat. |
| Closing | 2 / 2 | Show travel-management work without accidentally implying freight, a SOC or a generic call centre. | Three coordinators in a daylight travel-operations studio; screens deliberately soft and unreadable; calm attention rather than crisis. | **Used** as the operations clean select and final montage beat. |

## Stock used deliberately

All stock is free Pexels footage under the [Pexels licence](https://www.pexels.com/license/).

| Use | Pexels source | Local source |
| --- | --- | --- |
| Opening connection | [Busy Airport Terminal with Diverse Travelers — 37130620](https://www.pexels.com/video/37130620/) | `stock/seq02a-connection/01-busy-terminal-diverse-travelers-37130620.mp4` |
| Opening hotel | [Modern Hotel Lobby in Nanjing, China — 36219791](https://www.pexels.com/video/36219791/) | `stock/seq02c-hotel/01-modern-hotel-lobby-nanjing-36219791.mp4` |
| Opening commitment | [A Panning Shot of a Conference Room — 6951299](https://www.pexels.com/video/6951299/) | `stock/seq02d-event/01-conference-room-microphones-6951299.mp4` |
| Closing sport | [Aerial View of Outdoor Sport Event with Tents — 32525560](https://www.pexels.com/video/32525560/) | `stock/closing-sports/01-aerial-sports-event-32525560.mp4` |

The previous airport-board opener and airport-curb/transfer sources were
deliberately rejected from the final edit. Their literal board/brand detail made
the film feel less composed than the Wan-human-plus-real-consequence approach.

## Quality review and remaining risk

Editorial refinement replaced the stock board anchor with the second Wan result,
removed the branded transfer shot, and reviewed the finished opener and closing
through contact sheets. Each opener cut now contributes a distinct consequence;
each closing cut communicates a distinct operating context with narration muted.

**Strongest creative decision:** treating the prepared conference room as the
opening's endpoint. It makes the product claim about restoring a trip emotionally
legible before the graph explains it.

**Weakest remaining shot:** the travel-operations clip is intentionally quiet,
but its blurred schedule blocks are slightly more generic than the sport and
offsite images. Keep it brief, never zoom into the screens, and let the final
NORTHSTAR graph/lockup immediately give it specificity.

## Rebuild and verification

`scripts/generate-wan-video.ps1` submits or resumes a Wan task using an existing
local Model Studio credential. It never prints the API key or temporary result
URL. Downloaded source clips belong in `render/work/` and are ignored.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/render-cinematics.ps1
```

The production pass verified all five final outputs with FFprobe: H.264,
1920 x 1080, 30fps, yuv420p. Measured durations are 11.00s (opening), 4.00s for
each closing select and 9.60s (expansion montage). There is no baked narration,
subtitle, music or source audio.
