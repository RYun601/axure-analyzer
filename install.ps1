param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$SkillsRoot = "",
  [switch]$InstallDeps
)

$ErrorActionPreference = "Stop"

$PackRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($SkillsRoot)) {
  $SkillsRoot = Join-Path $ProjectRoot ".opencode\skills"
}

$Destination = Join-Path $SkillsRoot "axure-analyzer"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Copy-Item -LiteralPath (Join-Path $PackRoot "SKILL.md") -Destination (Join-Path $Destination "SKILL.md") -Force
Copy-Item -LiteralPath (Join-Path $PackRoot "package.json") -Destination (Join-Path $Destination "package.json") -Force
Copy-Item -LiteralPath (Join-Path $PackRoot "LICENSE") -Destination (Join-Path $Destination "LICENSE") -Force

$SourceScripts = Join-Path $PackRoot "scripts"
$DestScripts = Join-Path $Destination "scripts"
New-Item -ItemType Directory -Force -Path $DestScripts | Out-Null
Copy-Item -Path (Join-Path $SourceScripts "*") -Destination $DestScripts -Recurse -Force

$SourceReferences = Join-Path $PackRoot "references"
if (Test-Path -LiteralPath $SourceReferences) {
  $DestReferences = Join-Path $Destination "references"
  New-Item -ItemType Directory -Force -Path $DestReferences | Out-Null
  Copy-Item -Path (Join-Path $SourceReferences "*") -Destination $DestReferences -Recurse -Force
}

Write-Host "Installed skill: $Destination"

if ($InstallDeps) {
  Push-Location $Destination
  try {
    npm install --omit=dev --no-audit --no-fund
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Verify with:"
Write-Host "  node `"$Destination\scripts\analyze.js`" --input `"D:\path\to\axure-export`" --output `"analysis\axure`" --pages `"<page-name>`""
Write-Host ""
Write-Host "Note: restart the agent session if the skill is not listed immediately."
