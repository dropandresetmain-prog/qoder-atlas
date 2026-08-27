# Motion Canvas benchmark

This isolated experiment renders the 12-second NORTHSTAR dependency-graph benchmark. It is not connected to the production application.

Run `npm install`, then `npm run start` from this directory. Render the PNG image sequence in the Motion Canvas editor; the Vite configuration writes it to `render/project/`. The checked-in MP4 and four stills are produced from that sequence with a local FFmpeg binary. The bundled FFmpeg exporter could not run on this Windows ARM64 machine because its installer does not ship a matching binary.

The scene uses one Camera and one persistent world hierarchy: the 0:05–0:09 reveal is a continuous camera pull-back, not a crossfade to a separate graphic.
