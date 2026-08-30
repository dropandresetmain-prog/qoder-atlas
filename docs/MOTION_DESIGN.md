# Motion design source

Northstar's system-world film sequences are browser programs: HTML, CSS, SVG and
JavaScript visualise graph state, propagation and authority with deterministic timing.
The source lives in `video-production/`; rendered media is intentionally not committed.

## Why browser source

Travel-resolution state needs precise, repeatable changes: a dependency becomes at
risk, a blast radius expands, an overlay is tested, an approval gate interrupts the
flow. Browser code gives exact frame/state control, a shared design system, inspectable
SVG/DOM structure, version control and reproducible capture. Generated cinematic video
would be a poor fit for these diagrammatic system sequences.

The retained sequence chain covers rebooking, scale, objective field, Live Dependency
Graph, blast radius, resolution engine, Qwen/Atlas, authority, Qoder and the thesis
lockup. Shared modules and worlds are retained with every sequence so they remain
runnable rather than becoming orphaned HTML files.

## View and capture

Open a sequence `index.html` in a modern browser, for example
`video-production/seq06-live-dependency-graph/index.html`. The capture source uses
Playwright, Python Playwright/Chromium and FFmpeg to render deterministic timestamps
and encode media. It inlines local source for capture and makes no network call.

The current capture helper names a Linux Chromium executable path, so a non-Linux
machine may need an equivalent local Chromium path before rendering. This is a source
portability limitation, not a requirement for viewing the HTML sequences.

The authoritative provenance tag is `video-source-final-2026-08-30`.
