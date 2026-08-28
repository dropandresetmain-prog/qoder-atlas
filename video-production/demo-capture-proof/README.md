# Playwright demo-capture proof

This isolated, read-only recording proof opens the NORTHSTAR production site, opens Arjun Rao's case, then scrolls to the deterministic viability checks. It does not submit a resolution, request approval, or change a booking.

Run `node --experimental-strip-types video-production/demo-capture-proof/capture.spec.ts` from the repository root. The script explicitly uses a 1920×1080 viewport and 1920×1080 `recordVideo` size. Native Playwright output is WebM at `output/playwright-proof.webm`; the verified proof is 10.36 seconds at 1920×1080 and 25 fps.

Use a local FFmpeg binary to make an optional H.264 MP4 copy: `ffmpeg -i output/playwright-proof.webm -c:v libx264 -pix_fmt yuv420p output/playwright-proof.mp4`.
