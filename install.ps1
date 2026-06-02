param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$SkillsRoot = "$HOME\.claude\skills",
  [switch]$SkipProjectScripts
)

$ErrorActionPreference = "Stop"

$PackRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceSkills = Join-Path $PackRoot "skills"
$SourceScripts = Join-Path $PackRoot "scripts\axure"

if (-not (Test-Path -LiteralPath $SourceSkills)) {
  throw "Missing skills directory: $SourceSkills"
}

New-Item -ItemType Directory -Force -Path $SkillsRoot | Out-Null

foreach ($skill in @("axure-rp-html-ingest", "axure-requirements-doc-writer")) {
  $src = Join-Path $SourceSkills $skill
  $dst = Join-Path $SkillsRoot $skill
  if (-not (Test-Path -LiteralPath (Join-Path $src "SKILL.md"))) {
    throw "Missing SKILL.md for $skill"
  }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -LiteralPath (Join-Path $src "SKILL.md") -Destination (Join-Path $dst "SKILL.md") -Force
  Write-Host "Installed skill: $dst"
}

if (-not $SkipProjectScripts) {
  if (-not (Test-Path -LiteralPath $ProjectRoot)) {
    throw "ProjectRoot does not exist: $ProjectRoot"
  }
  $dstScripts = Join-Path $ProjectRoot "scripts\axure"
  New-Item -ItemType Directory -Force -Path $dstScripts | Out-Null
  Copy-Item -LiteralPath (Join-Path $SourceScripts "ingest_axure_html.js") -Destination $dstScripts -Force
  Copy-Item -LiteralPath (Join-Path $SourceScripts "make_axure_context_pack.js") -Destination $dstScripts -Force
  Copy-Item -LiteralPath (Join-Path $SourceScripts "make_requirements_doc.js") -Destination $dstScripts -Force
  Write-Host "Installed project scripts: $dstScripts"
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Verify with: powershell -ExecutionPolicy Bypass -File .\verify.ps1 -ProjectRoot `"$ProjectRoot`""
