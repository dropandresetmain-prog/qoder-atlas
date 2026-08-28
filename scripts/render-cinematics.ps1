param(
  [string]$FfmpegPath = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($FfmpegPath)) {
  $wingetAlias = "C:\Users\sethl\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
  if (Test-Path -LiteralPath $wingetAlias) {
    # Invoke the resolved target: the WinGet link is not executable in every shell host.
    $FfmpegPath = (Get-Item -LiteralPath $wingetAlias).Target[0]
  }
}

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($null -eq $command) { throw 'FFmpeg is required. Install it or pass -FfmpegPath.' }
  $FfmpegPath = $command.Source
}

$stock = Join-Path $repoRoot 'video-production/cinematics/stock'
$render = Join-Path $repoRoot 'video-production/cinematics/render'
$closing = Join-Path $render 'closing'
New-Item -ItemType Directory -Force -Path $render, $closing | Out-Null

$openerSources = @(
  (Join-Path $stock 'seq01-opener/01-traveller-at-airport-board-20606522.mp4'),
  (Join-Path $stock 'seq02a-connection/01-busy-terminal-diverse-travelers-37130620.mp4'),
  (Join-Path $stock 'seq02b-transfer/02-airport-terminal-entrance-27584214.mp4'),
  (Join-Path $stock 'seq02c-hotel/01-modern-hotel-lobby-nanjing-36219791.mp4'),
  (Join-Path $stock 'seq02d-event/01-conference-room-microphones-6951299.mp4')
)

foreach ($source in $openerSources) {
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing source footage: $source" }
}

# The opener progresses from one observer at the board to a denser connection,
# then a brief curb dependency, then hotel and an intentionally longer event hold.
$openerFilter = @'
[0:v]trim=start=1.2:end=4.4,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,setsar=1,fade=t=in:st=0:d=0.25,fade=t=out:st=2.90:d=0.30[v0];
[1:v]trim=start=1.8:end=3.5,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,setsar=1,fade=t=in:st=0:d=0.16,fade=t=out:st=1.48:d=0.22[v1];
[2:v]trim=start=3.0:end=4.3,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,setsar=1,fade=t=in:st=0:d=0.14,fade=t=out:st=1.08:d=0.20[v2];
[3:v]trim=start=0.8:end=2.5,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,setsar=1,fade=t=in:st=0:d=0.16,fade=t=out:st=1.48:d=0.22[v3];
[4:v]trim=start=1.8:end=4.9,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,setsar=1,fade=t=in:st=0:d=0.20,fade=t=out:st=2.78:d=0.32[v4];
[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[outv]
'@ -replace "`r?`n", ''

& $FfmpegPath -y -hide_banner -loglevel warning `
  -i $openerSources[0] -i $openerSources[1] -i $openerSources[2] -i $openerSources[3] -i $openerSources[4] `
  -filter_complex $openerFilter -map '[outv]' -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart `
  (Join-Path $render 'seq01-02-cinematic-opener.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the cinematic opener.' }

$sportsSource = Join-Path $stock 'closing-sports/01-aerial-sports-event-32525560.mp4'
& $FfmpegPath -y -hide_banner -loglevel warning -ss 2.0 -t 4.0 -i $sportsSource `
  -vf 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.04:brightness=-0.015:saturation=0.90,fps=30,fade=t=in:st=0:d=0.22,fade=t=out:st=3.72:d=0.28' `
  -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart (Join-Path $closing 'sports.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the sports insert.' }

Write-Host 'Rendered:'
Write-Host (Join-Path $render 'seq01-02-cinematic-opener.mp4')
Write-Host (Join-Path $closing 'sports.mp4')
