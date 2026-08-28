param(
  [string]$FfmpegPath = "",
  [string]$WanOpeningPath = "",
  [string]$WanOffsitePath = "",
  [string]$WanOperationsPath = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($FfmpegPath)) {
  $wingetAlias = "C:\Users\sethl\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
  if (Test-Path -LiteralPath $wingetAlias) {
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
$work = Join-Path $render 'work'
$closing = Join-Path $render 'closing'
New-Item -ItemType Directory -Force -Path $render, $work, $closing | Out-Null

if ([string]::IsNullOrWhiteSpace($WanOpeningPath)) { $WanOpeningPath = Join-Path $work 'wan-opening-traveller-state-change.mp4' }
if ([string]::IsNullOrWhiteSpace($WanOffsitePath)) { $WanOffsitePath = Join-Path $work 'wan-closing-offsite-source.mp4' }
if ([string]::IsNullOrWhiteSpace($WanOperationsPath)) { $WanOperationsPath = Join-Path $work 'wan-closing-operations-source.mp4' }

$openerSources = @(
  $WanOpeningPath,
  (Join-Path $stock 'seq02a-connection/01-busy-terminal-diverse-travelers-37130620.mp4'),
  (Join-Path $stock 'seq02c-hotel/01-modern-hotel-lobby-nanjing-36219791.mp4'),
  (Join-Path $stock 'seq02d-event/01-conference-room-microphones-6951299.mp4')
)
$closingSources = @(
  (Join-Path $stock 'closing-sports/01-aerial-sports-event-32525560.mp4'),
  $WanOffsitePath,
  $WanOperationsPath
)
foreach ($source in @($openerSources + $closingSources)) {
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing cinematic source footage: $source" }
}

# Cut with new information instead of adding decorative transitions. The final
# conference-room hold washes into NORTHSTAR's cockpit-daylight neutral.
$openerFilter = @'
[0:v]trim=start=0.4:end=4.1,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.02:brightness=0.005:saturation=0.88,fps=30,setsar=1,fade=t=in:st=0:d=0.20[v0];
[1:v]trim=start=1.8:end=3.2,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.03:brightness=-0.005:saturation=0.88,fps=30,setsar=1[v1];
[2:v]trim=start=0.8:end=2.6,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.03:brightness=-0.005:saturation=0.88,fps=30,setsar=1[v2];
[3:v]trim=start=1.8:end=5.9,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.03:brightness=0.005:saturation=0.86,fps=30,setsar=1,fade=t=out:st=3.72:d=0.38:color=0xF2F4F5[v3];
[v0][v1][v2][v3]concat=n=4:v=1:a=0[outv]
'@ -replace "`r?`n", ''

& $FfmpegPath -y -hide_banner -loglevel warning `
  -i $openerSources[0] -i $openerSources[1] -i $openerSources[2] -i $openerSources[3] `
  -filter_complex $openerFilter -map '[outv]' -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart `
  (Join-Path $render 'seq01-02-cinematic-opener.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the cinematic opener.' }

# Clean expansion selects remain useful to the final assembly even if it chooses
# a different graph/lockup cadence than this recommended montage.
& $FfmpegPath -y -hide_banner -loglevel warning -ss 2.0 -t 4.0 -i $closingSources[0] `
  -vf 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.03:brightness=-0.005:saturation=0.88,fps=30' `
  -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart (Join-Path $closing 'sports.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the sports select.' }

& $FfmpegPath -y -hide_banner -loglevel warning -ss 0.5 -t 4.0 -i $closingSources[1] `
  -vf 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.02:brightness=0.005:saturation=0.88,fps=30' `
  -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart (Join-Path $closing 'offsite.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the offsite select.' }

& $FfmpegPath -y -hide_banner -loglevel warning -ss 0.5 -t 4.0 -i $closingSources[2] `
  -vf 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.02:brightness=0.005:saturation=0.86,fps=30' `
  -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart (Join-Path $closing 'operations.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the operations select.' }

$closingFilter = @'
[0:v]trim=start=0:end=3.1,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.18[v0];
[1:v]trim=start=0.2:end=3.3,setpts=PTS-STARTPTS[v1];
[2:v]trim=start=0.2:end=3.6,setpts=PTS-STARTPTS,fade=t=out:st=3.05:d=0.35:color=0xF2F4F5[v2];
[v0][v1][v2]concat=n=3:v=1:a=0[outv]
'@ -replace "`r?`n", ''

& $FfmpegPath -y -hide_banner -loglevel warning `
  -i (Join-Path $closing 'sports.mp4') -i (Join-Path $closing 'offsite.mp4') -i (Join-Path $closing 'operations.mp4') `
  -filter_complex $closingFilter -map '[outv]' -an -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart `
  (Join-Path $render 'closing-cinematic-expansion.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed to render the closing expansion montage.' }

Write-Host 'Rendered:'
Write-Host (Join-Path $render 'seq01-02-cinematic-opener.mp4')
Write-Host (Join-Path $render 'closing-cinematic-expansion.mp4')
Write-Host (Join-Path $closing 'sports.mp4')
Write-Host (Join-Path $closing 'offsite.mp4')
Write-Host (Join-Path $closing 'operations.mp4')
