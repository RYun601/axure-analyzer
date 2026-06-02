param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$SampleInput = ""
)

$ErrorActionPreference = "Stop"

Write-Host "Checking Node.js..."
node --version

Write-Host ""
Write-Host "Checking skill visibility..."
$skillsRoot = "$HOME\.claude\skills"
foreach ($skill in @("axure-rp-html-ingest", "axure-requirements-doc-writer")) {
  $skillPath = Join-Path $skillsRoot "$skill\SKILL.md"
  if (Test-Path -LiteralPath $skillPath) {
    Write-Host "Found skill: $skill -> $skillPath"
  } else {
    Write-Host "Missing skill: $skill (expected at $skillPath)"
  }
}

$ingest = Join-Path $ProjectRoot "scripts\axure\ingest_axure_html.js"
$writer = Join-Path $ProjectRoot "scripts\axure\make_requirements_doc.js"

if (-not (Test-Path -LiteralPath $ingest)) {
  throw "Missing project script: $ingest"
}
if (-not (Test-Path -LiteralPath $writer)) {
  throw "Missing project script: $writer"
}

Write-Host ""
Write-Host "Project scripts found."

if ($SampleInput) {
  Write-Host ""
  Write-Host "Running Axure ingest dry-run..."
  node $ingest --input $SampleInput --max-pages 3 --dry-run
}

Write-Host ""
Write-Host "Verification complete."
