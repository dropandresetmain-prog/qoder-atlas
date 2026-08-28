param(
  [string]$Prompt = "",

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [string]$ConfigPath = "",
  [string]$Model = "wan2.7-t2v-2026-06-12",
  [ValidateSet('720P', '1080P')]
  [string]$Resolution = '1080P',
  [ValidateSet(10, 15)]
  [int]$Duration = 10,
  [int]$PollSeconds = 15,
  [string]$TaskId = "",
  [switch]$SubmitOnly
)

$ErrorActionPreference = 'Stop'

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object {
    $_ -match ("^{0}=" -f [regex]::Escape($Name))
  } | Select-Object -First 1
  if ($null -eq $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"')
}

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'
}

$apiKey = $env:DASHSCOPE_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) { $apiKey = $env:MODEL_STUDIO_API_KEY }
if ([string]::IsNullOrWhiteSpace($apiKey)) { $apiKey = Read-DotEnvValue $ConfigPath 'DASHSCOPE_API_KEY' }
if ([string]::IsNullOrWhiteSpace($apiKey)) { $apiKey = Read-DotEnvValue $ConfigPath 'MODEL_STUDIO_API_KEY' }
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'Wan generation requires DASHSCOPE_API_KEY or MODEL_STUDIO_API_KEY.' }

$baseUrl = $env:MODEL_STUDIO_BASE_URL
if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = Read-DotEnvValue $ConfigPath 'MODEL_STUDIO_BASE_URL' }
if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }
$apiUri = [uri]$baseUrl
$wanApiBase = '{0}://{1}/api/v1' -f $apiUri.Scheme, $apiUri.Host
$submitUri = "$wanApiBase/services/aigc/video-generation/video-synthesis"

$headers = @{
  Authorization = "Bearer $apiKey"
  'X-DashScope-Async' = 'enable'
}

if ([string]::IsNullOrWhiteSpace($TaskId)) {
  if ([string]::IsNullOrWhiteSpace($Prompt)) { throw 'Provide either Prompt or TaskId.' }
  $request = @{
    model = $Model
    input = @{
      prompt = $Prompt
      negative_prompt = 'visible text, subtitles, watermarks, logos, brand names, readable screens, UI overlays, neon, cyberpunk, disaster scene, exaggerated distress, fake smiling corporate stock, handshake, distorted hands, malformed people'
    }
    parameters = @{
      resolution = $Resolution
      ratio = '16:9'
      duration = $Duration
      prompt_extend = $true
      watermark = $false
    }
  } | ConvertTo-Json -Depth 6
  try {
    $created = Invoke-RestMethod -Method Post -Uri $submitUri -Headers $headers -ContentType 'application/json' -Body $request
  } catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'unknown' }
    throw "Wan task submission failed (HTTP $statusCode). Check the Model Studio region, model access, capacity, and configured API key."
  }
  $TaskId = $created.output.task_id
  if ([string]::IsNullOrWhiteSpace($TaskId)) { throw 'Wan task submission returned no task ID.' }
  Write-Host "Wan task submitted (id: $TaskId). Polling for completion..."
  if ($SubmitOnly) { return }
} else {
  Write-Host "Resuming Wan task (id: $TaskId). Polling for completion..."
}

$taskUri = "$wanApiBase/tasks/$TaskId"
$result = $null
$firstPoll = $true
while ($true) {
  if (-not $firstPoll) { Start-Sleep -Seconds $PollSeconds }
  $firstPoll = $false
  try {
    $result = Invoke-RestMethod -Method Get -Uri $taskUri -Headers @{ Authorization = "Bearer $apiKey" }
  } catch {
    throw 'Wan task polling failed. The task may still be running; do not resubmit it automatically.'
  }
  $status = $result.output.task_status
  if ($status -eq 'SUCCEEDED') { break }
  if ($status -eq 'FAILED' -or $status -eq 'UNKNOWN') { throw "Wan task finished with status $status." }
  Write-Host 'Wan task still running...'
}

$videoUrl = $result.output.video_url
if ([string]::IsNullOrWhiteSpace($videoUrl)) { throw 'Wan task succeeded but returned no downloadable video URL.' }
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Invoke-WebRequest -Uri $videoUrl -OutFile $OutputPath
if (-not (Test-Path -LiteralPath $OutputPath) -or (Get-Item -LiteralPath $OutputPath).Length -lt 1024) {
  throw 'Wan download did not produce a usable video file.'
}
Write-Host "Wan video downloaded: $OutputPath"
