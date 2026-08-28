#!/usr/bin/env python3
"""Reusable deterministic Chromium -> frame sequence -> FFmpeg capture harness."""
from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
from pathlib import Path
import re
import base64

from playwright.async_api import async_playwright


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument('--html', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--duration', required=True, type=float)
    p.add_argument('--fps', type=int, default=30, help='Output MP4 fps')
    p.add_argument('--capture-fps', type=int, default=0, help='Deterministic browser sampling fps; 0 uses output fps')
    p.add_argument('--stills', default='')
    p.add_argument('--stills-dir', default='')
    p.add_argument('--stills-only', action='store_true')
    p.add_argument('--keep-frames', action='store_true')
    return p.parse_args()


async def main() -> None:
    args = parse_args()
    html = Path(args.html).resolve()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    frames_dir = out.parent / 'frames'
    stills_dir = Path(args.stills_dir).resolve() if args.stills_dir else out.parent / 'stills'
    stills_dir.mkdir(parents=True, exist_ok=True)
    still_times = [float(x.strip()) for x in args.stills.split(',') if x.strip()]

    if frames_dir.exists() and not args.keep_frames:
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Chromium in some managed environments blocks file:// and localhost navigation.
    # Inline all local CSS/JS into an about:blank document so deterministic capture
    # has no network or navigation dependency.
    source = html.read_text(encoding='utf-8')
    base = html.parent

    def inline_css(match):
        href = match.group(1)
        if href.startswith(('http://', 'https://')):
            return match.group(0)
        css = (base / href).resolve().read_text(encoding='utf-8')
        return f'<style data-inline-source=\"{href}\">\n{css}\n</style>'

    def inline_js(match):
        src = match.group(1)
        if src.startswith(('http://', 'https://')):
            return ''
        js = (base / src).resolve().read_text(encoding='utf-8')
        return f'<script data-inline-source=\"{src}\">\n{js}\n</script>'

    source = re.sub(r'<link\s+rel=\"stylesheet\"\s+href=\"([^\"]+)\"\s*/?>', inline_css, source)
    source = re.sub(r'<script\s+src=\"([^\"]+)\"\s*></script>', inline_js, source)
    source = source.replace('<head>', '<head>\n<script>window.__NS_CAPTURE__=true;document.documentElement.classList.add(\"ns-capture\");</script>', 1)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            executable_path='/usr/bin/chromium',
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        await page.set_content(source, wait_until='load')
        await page.wait_for_function('window.__NS_READY__ === true')

        for idx, t in enumerate(still_times, start=1):
            await page.evaluate('(t) => window.__NS_RENDER_AT__(t)', t)
            await page.screenshot(path=str(stills_dir / f'{idx:02d}-{t:05.2f}s.png'), type='png')

        if not args.stills_only:
            # The DevTools screenshot path is materially faster than Playwright's
            # high-level screenshot wrapper on graph-heavy
            # exact renderAt(timestamp) determinism.
            cdp = await page.context.new_cdp_session(page)
            capture_fps = args.capture_fps or args.fps
            total = round(args.duration * capture_fps)
            for i in range(total):
                t = i / capture_fps
                await page.evaluate('(t) => window.__NS_RENDER_AT__(t)', t)
                shot = await cdp.send('Page.captureScreenshot', {
                    'format': 'jpeg',
                    'quality': 92,
                    'fromSurface': True,
                    'captureBeyondViewport': False,
                })
                (frames_dir / f'frame-{i:04d}.jpg').write_bytes(base64.b64decode(shot['data']))
        await browser.close()

    if not args.stills_only:
        capture_fps = args.capture_fps or args.fps
        cmd = [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-framerate', str(capture_fps),
            '-i', str(frames_dir / 'frame-%04d.jpg'),
        ]
        if capture_fps != args.fps:
            # Blend-based temporal interpolation keeps the final asset at the
            # requested delivery fps while browser states remain deterministic.
            cmd += ['-vf', f'minterpolate=fps={args.fps}:mi_mode=blend']
        cmd += [
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '15',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)
        ]
        subprocess.run(cmd, check=True)
        if not args.keep_frames:
            shutil.rmtree(frames_dir)


if __name__ == '__main__':
    asyncio.run(main())
