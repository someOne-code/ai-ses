[CmdletBinding()]
param(
  [string]$BaseBranch = "main",
  [string]$Title,
  [string]$BodyFile
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$script:GitHubCliCommand = $null

function Resolve-GitHubCliCommand {
  $candidatePaths = @()
  $command = Get-Command gh -ErrorAction SilentlyContinue

  if ($command) {
    return $command.Source
  }

  if ($IsWindows) {
    $candidatePaths += @(
      "C:\Program Files\GitHub CLI\gh.exe",
      "C:\Program Files\GitHub CLI\bin\gh.exe",
      (Join-Path $env:LOCALAPPDATA "Programs\GitHub CLI\gh.exe")
    )
  }

  foreach ($candidate in $candidatePaths) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Get-TrimmedCommandOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Command
  )

  $commandName = $Command[0]
  $commandArgs = @()

  if ($Command.Length -gt 1) {
    $commandArgs = $Command[1..($Command.Length - 1)]
  }

  $output = & $commandName @commandArgs 2>$null

  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return ($output | Out-String).Trim()
}

function Invoke-Gh {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  if (-not $script:GitHubCliCommand) {
    throw "GitHub CLI command path is not initialized."
  }

  & $script:GitHubCliCommand @Arguments
}

function Get-GhVersion {
  $versionLine = Get-TrimmedCommandOutput -Command @($script:GitHubCliCommand, "--version")

  if (-not $versionLine) {
    return $null
  }

  $firstLine = $versionLine.Split([Environment]::NewLine)[0]
  $match = [regex]::Match($firstLine, "gh version (?<version>\d+\.\d+\.\d+)")

  if (-not $match.Success) {
    return $null
  }

  return [version]$match.Groups["version"].Value
}

Push-Location $repoRoot

try {
  $script:GitHubCliCommand = Resolve-GitHubCliCommand
  if (-not $script:GitHubCliCommand) {
    throw "GitHub CLI ('gh') is required. Install it first, then rerun scripts/open-ai-draft-pr.ps1."
  }

  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCommand) {
    throw "Git is required but was not found in PATH."
  }

  $ghVersion = Get-GhVersion
  if (-not $ghVersion -or $ghVersion -lt [version]"2.88.0") {
    throw "GitHub CLI v2.88.0 or newer is required so @copilot can be requested as a reviewer."
  }

  $authStatus = Get-TrimmedCommandOutput -Command @($script:GitHubCliCommand, "auth", "status")
  if (-not $authStatus) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
  }

  $branchName = Get-TrimmedCommandOutput -Command @("git", "rev-parse", "--abbrev-ref", "HEAD")
  if (-not $branchName -or $branchName -eq "HEAD") {
    throw "Cannot open a PR from a detached HEAD."
  }

  if ($branchName -eq $BaseBranch) {
    throw "Refusing to open a draft PR from the base branch '$BaseBranch'. Create a feature branch first."
  }

  $upstreamBranch = Get-TrimmedCommandOutput -Command @("git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
  if (-not $upstreamBranch) {
    throw "Current branch '$branchName' does not have an upstream branch. Push it first with 'git push -u origin $branchName'."
  }

  $existingPrUrl = Get-TrimmedCommandOutput -Command @($script:GitHubCliCommand, "pr", "view", "--json", "url", "--jq", ".url")
  $prUrl = $existingPrUrl

  if (-not $existingPrUrl) {
    $createArgs = @("pr", "create", "--draft", "--base", $BaseBranch, "--fill")

    if ($Title) {
      $createArgs += @("--title", $Title)
    }

    if ($BodyFile) {
      if (-not (Test-Path $BodyFile)) {
        throw "Body file not found: $BodyFile"
      }

      $resolvedBodyFile = (Resolve-Path $BodyFile).Path
      $createArgs += @("--body-file", $resolvedBodyFile)
    }

    Invoke-Gh @createArgs

    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create the draft pull request."
    }

    $prUrl = Get-TrimmedCommandOutput -Command @($script:GitHubCliCommand, "pr", "view", "--json", "url", "--jq", ".url")
  }

  Invoke-Gh pr edit --add-reviewer "@copilot"

  if ($LASTEXITCODE -ne 0) {
    throw "PR was created but requesting @copilot review failed. Check that Copilot code review is enabled for this repo."
  }

  if (-not $prUrl) {
    $prUrl = Get-TrimmedCommandOutput -Command @($script:GitHubCliCommand, "pr", "view", "--json", "url", "--jq", ".url")
  }

  Write-Host "Draft PR ready: $prUrl"
  Write-Host "Copilot review requested."
  Write-Host "Next step: wait for the review, then comment /copilot-autofix on the PR if you want one controlled AI fix pass."
}
finally {
  Pop-Location
}
