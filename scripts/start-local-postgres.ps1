param(
  [string]$EnvFile,
  [string]$LogPath,
  [switch]$SkipDockerAutostart
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "infra\postgres\compose.yaml"

if (-not $EnvFile) {
  $EnvFile = Join-Path $repoRoot "infra\postgres\.env.local"
}

if (-not $LogPath) {
  $LogPath = Join-Path $repoRoot "app\backend\.tmp\postgres-docker-runtime.log"
}

if (-not (Test-Path $composeFile)) {
  throw "Missing compose file at $composeFile"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing local Postgres env file at $EnvFile. Copy infra/postgres/.env.local.example to infra/postgres/.env.local first."
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

function Test-DockerReady {
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Ensure-DockerReady {
  if (Test-DockerReady) {
    return
  }

  if ($SkipDockerAutostart) {
    throw "Docker daemon is not running. Start Docker Desktop and rerun the script."
  }

  $dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

  if (-not (Test-Path $dockerDesktopExe)) {
    throw "Docker Desktop executable not found at $dockerDesktopExe"
  }

  Write-Host "Starting Docker Desktop..."
  Start-Process -FilePath $dockerDesktopExe | Out-Null

  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    Start-Sleep -Seconds 2

    if (Test-DockerReady) {
      return
    }
  }

  throw "Docker daemon did not become ready in time."
}

function Get-DockerContainerPublishingPort {
  param([int]$Port)

  $containers = & docker ps --format "{{.Names}}|{{.Ports}}" 2>$null

  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  foreach ($container in $containers) {
    if ([string]::IsNullOrWhiteSpace($container)) {
      continue
    }

    $parts = $container -split "\|", 2

    if ($parts.Length -lt 2) {
      continue
    }

    if ($parts[1] -match ":$Port->") {
      return $parts[0]
    }
  }

  return $null
}

function Stop-LegacyNativePostgres {
  param(
    [int]$Port,
    [string]$LegacyDataDir,
    [string]$ExpectedContainerName
  )

  $containerPublishingPort = Get-DockerContainerPublishingPort -Port $Port

  if ($containerPublishingPort) {
    if ($containerPublishingPort -eq $ExpectedContainerName) {
      Write-Host "Port $Port is already published by Docker container $ExpectedContainerName."
      return
    }

    throw "Port $Port is already published by Docker container $containerPublishingPort. Refusing to override an unexpected container."
  }

  $listeners = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" }

  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"

    if (-not $process) {
      continue
    }

    $commandLine = $process.CommandLine

    if (
      $process.Name -eq "postgres.exe" -and
      $commandLine -like "*$LegacyDataDir*"
    ) {
      Write-Host "Stopping legacy native Postgres on port $Port (PID $($process.ProcessId))..."
      Stop-Process -Id $process.ProcessId -Force
      Start-Sleep -Seconds 2
      continue
    }

    if ($process.Name -in @("wslrelay.exe", "com.docker.backend.exe")) {
      Write-Host "Port $Port is reserved by Docker relay services. Continuing because no unexpected running container is publishing it."
      return
    }

    throw "Port $Port is already in use by PID $($process.ProcessId) ($($process.Name)). Refusing to override an unexpected process."
  }
}

function Wait-ForContainerHealth {
  param([string]$ContainerName)

  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    $status = & docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerName 2>$null

    if ($LASTEXITCODE -eq 0 -and $status -match "healthy|running") {
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "Container $ContainerName did not become healthy in time."
}

function Ensure-VectorExtension {
  param(
    [string]$ContainerName,
    [string]$Database,
    [string]$User,
    [string]$LogPath
  )

  $extensionOutput = & docker exec $ContainerName psql -v ON_ERROR_STOP=1 -U $User -d $Database -c "CREATE EXTENSION IF NOT EXISTS vector;" *>&1
  $extensionOutput |
    ForEach-Object { "$_" } |
    Tee-Object -FilePath $LogPath -Append

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to enable pgvector in database $Database. See $LogPath"
  }
}

function Remove-StaleContainerIfNeeded {
  param([string]$ContainerName)

  $existingContainerId = (& docker ps -aq -f "name=^/${ContainerName}$" 2>$null | Select-Object -First 1)

  if (-not $existingContainerId) {
    return
  }

  $status = & docker inspect --format "{{.State.Status}}" $ContainerName 2>$null

  if ($LASTEXITCODE -ne 0) {
    return
  }

  if ($status -eq "running") {
    return
  }

  Write-Host "Removing stale container $ContainerName ($status)..."
  & docker rm -f $ContainerName *> $null

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to remove stale container $ContainerName"
  }
}

Set-EnvFromFile -Path $EnvFile

$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$postgresDataDir = Join-Path $repoRoot "infra\postgres\data"
if (-not (Test-Path $postgresDataDir)) {
  New-Item -ItemType Directory -Path $postgresDataDir | Out-Null
}

$hostPortValue = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "5433" }
$containerName = if ($env:POSTGRES_CONTAINER_NAME) { $env:POSTGRES_CONTAINER_NAME } else { "ai-ses-postgres" }
$legacyDataDir = (Join-Path $repoRoot "app\backend\.tmp\postgres-data").Replace("\", "/")

Write-Host "Starting local Postgres for ai-ses..."
Write-Host "Env file: $EnvFile"
Write-Host "Compose file: $composeFile"
Write-Host "Container: $containerName"
Write-Host "Host port: $hostPortValue"
Write-Host "Log file: $LogPath"

Ensure-DockerReady
Stop-LegacyNativePostgres -Port ([int]$hostPortValue) -LegacyDataDir $legacyDataDir -ExpectedContainerName $containerName
Remove-StaleContainerIfNeeded -ContainerName $containerName

$composeOutput = & docker compose --env-file $EnvFile -f $composeFile up -d *>&1
$composeOutput |
  ForEach-Object { "$_" } |
  Tee-Object -FilePath $LogPath

if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed. See $LogPath"
}

Wait-ForContainerHealth -ContainerName $containerName
Ensure-VectorExtension -ContainerName $containerName -Database $env:POSTGRES_DB -User $env:POSTGRES_USER -LogPath $LogPath

Write-Host ""
Write-Host "Local pgvector Postgres is ready."
Write-Host "Next steps:"
Write-Host "  cd $(Join-Path $repoRoot 'app\backend')"
Write-Host "  npm run db:migrate"
Write-Host "  npm run seed:local-demo"
