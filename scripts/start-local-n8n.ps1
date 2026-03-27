param(
  [string]$EnvFile,
  [string]$LogPath
)

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $EnvFile) {
  $EnvFile = Join-Path $repoRoot "infra\n8n\.env.local"
}

if (-not $LogPath) {
  $LogPath = Join-Path $env:USERPROFILE ".n8n\ai-ses-runtime.log"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing local n8n env file at $EnvFile. Copy infra/n8n/.env.local.example to infra/n8n/.env.local first."
}

function Set-EnvFromFile {
  param([string]$Path)

  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()

    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")

    if ($separatorIndex -le 0) {
      continue
    }

    $name = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

Set-EnvFromFile -Path $EnvFile

$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$n8nCommand = Get-Command n8n -ErrorAction SilentlyContinue

Write-Host "Starting local n8n for ai-ses..."
Write-Host "Env file: $EnvFile"
Write-Host "Log file: $LogPath"

if ($n8nCommand) {
  & $n8nCommand.Source *>> $LogPath
  exit $LASTEXITCODE
}

$nodeScript = Join-Path $env:APPDATA "npm\node_modules\n8n\bin\n8n"

if (-not (Test-Path $nodeScript)) {
  throw "n8n command not found. Install n8n globally or update scripts/start-local-n8n.ps1 with the correct executable path."
}

& node $nodeScript *>> $LogPath
exit $LASTEXITCODE
