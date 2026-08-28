# NORTHSTAR cinematic production report

Date: 2026-08-28

## Result

**PARTIAL.** The real-world opener and sports insert are rendered and technically verified. Corporate offsite and travel-operations/TMC have no truthful free-stock render; **Wan generation recommended** for both rather than shipping staged or misleading footage.

## Local deliverables

| Deliverable | Local path | Duration | Delivery format |
| --- | --- | ---: | --- |
| SEQ 01–02 cinematic opener | `video-production/cinematics/render/seq01-02-cinematic-opener.mp4` | 11.03s | 1920 x 1080, H.264, yuv420p, 30fps, silent |
| Closing sports insert | `video-production/cinematics/render/closing/sports.mp4` | 4.00s | 1920 x 1080, H.264, yuv420p, 30fps, silent |

The MP4s and review contact sheets remain local and Git-ignored. Rebuild them with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/render-cinematics.ps1
```

## Opener editorial construction

The 11-second cut is deliberately a cause-and-consequence progression, not an airport montage:

1. **0.00–3.20 — traveller / flight-state anchor.** Airport board and a traveller in the same observational frame establish one person facing a travel-state change.
2. **3.20–4.90 — connection.** A brighter gate corridor with moving passengers and luggage gives the first downstream implication.
3. **4.90–6.20 — transfer.** A quiet terminal entrance / waiting-vehicle lane communicates a ground movement depending on arrival.
4. **6.20–7.90 — hotel.** A clean, modern lobby makes the accommodation consequence immediate without staged reception acting.
5. **7.90–11.03 — event commitment.** The prepared room, microphones and empty seats receive the longest hold so the keynote/event consequence lands hardest and can cut cleanly into NORTHSTAR's system world.

Treatment is limited to neutral cool matching (slight contrast lift, reduced saturation), reframing without aspect stretch, and short fades between consequences. There is no source audio, music, subtitles, logos, text overlay, or NORTHSTAR graphic.

## Exact sources used

All sources are free Pexels footage under the [Pexels licence](https://www.pexels.com/license/).

| Use | Pexels source | Local source file |
| --- | --- | --- |
| SEQ 01 board/traveller | [A Man Is Looking at a Large Screen at an Airport — 20606522](https://www.pexels.com/video/20606522/) | `stock/seq01-opener/01-traveller-at-airport-board-20606522.mp4` |
| Connection | [Busy Airport Terminal with Diverse Travelers — 37130620](https://www.pexels.com/video/37130620/) | `stock/seq02a-connection/01-busy-terminal-diverse-travelers-37130620.mp4` |
| Transfer | [Heathrow 1 / airport terminal entrance — 27584214](https://www.pexels.com/video/27584214/) | `stock/seq02b-transfer/02-airport-terminal-entrance-27584214.mp4` |
| Hotel | [Modern Hotel Lobby in Nanjing — 36219791](https://www.pexels.com/video/36219791/) | `stock/seq02c-hotel/01-modern-hotel-lobby-nanjing-36219791.mp4` |
| Event | [A Panning Shot of a Conference Room — 6951299](https://www.pexels.com/video/6951299/) | `stock/seq02d-event/01-conference-room-microphones-6951299.mp4` |
| Sports | [Aerial View of Outdoor Sport Event with Tents — 32525560](https://www.pexels.com/video/32525560/) | `stock/closing-sports/01-aerial-sports-event-32525560.mp4` |

Additional free sources found in this production pass:

- [Airport terminal entrance / pickup lane — 27584214](https://www.pexels.com/video/27584214/) was retained and replaced the previously downloaded pickup-zone footage.
- [Busy airport pickup zone — 28913144](https://www.pexels.com/video/28913144/) was downloaded for review then discarded from the edit: every useful crop retained prominent third-party pickup branding.
- Offsite searches (`business group walking hotel resort`) returned generic office walks, non-corporate resort/hiking scenes, or posed team footage.
- Operations searches (`operations team monitors office`) returned traffic-control/SOC footage, warehouse logistics, or generic call centres—not truthful travel coordination.

## Wan generation recommendations

| Slot | Decision | Why |
| --- | --- | --- |
| Closing corporate offsite | **WAN GENERATION RECOMMENDED** | No free source established a premium professional retreat/destination group without a staged corporate-stock signal. |
| Closing travel operations / TMC | **WAN GENERATION RECOMMENDED** | No free source credibly showed people coordinating multiple journeys/screens without turning NORTHSTAR into traffic surveillance, cybersecurity, freight, or a generic call centre. |

## Review and refinement evidence

- Generated local contact sheets for the opener, connection candidate, replacement transfer candidate and sports insert.
- Performed two intentional refinements: replaced the weak/dark connection selection with the brighter gate corridor; then rejected the branded pickup-zone footage in favour of the terminal-entrance source.
- Final FFprobe check: both retained renders are H.264, 1920 x 1080, yuv420p, 30fps. Opener is 11.03 seconds; sports is 4.00 seconds.

## Strongest decision and remaining weakness

**Strongest editorial decision:** hold the prepared conference room longest. It turns the generic travel disruption into a concrete missed-commitment consequence before the film enters NORTHSTAR's state-led world.

**Remaining weakness:** the free transfer source clearly conveys airport ground movement but is observational rather than a premium waiting-driver close-up. It is serviceable only as a short bridge; a purpose-generated transfer detail would improve the cut if Wan capacity becomes available.
