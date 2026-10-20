param(
  [string]$SampleInput = "",
  [string]$Page = "PageName"
)

$ErrorActionPreference = "Stop"
$PackRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Checking Node.js..."
node --version

Write-Host ""
Write-Host "Checking skill files..."
$required = @(
  "SKILL.md",
  "package.json",
  "scripts\analyze.js",
  "scripts\render_pages.js",
  "scripts\build_baseline.js",
  "scripts\ocr_pages.js",
  "scripts\ocr_image.py",
  "scripts\axure\ingest_axure_html.js",
  "references\pitfalls.md"
)
foreach ($file in $required) {
  $full = Join-Path $PackRoot $file
  if (Test-Path -LiteralPath $full) {
    Write-Host "  [ok] $file"
  } else {
    Write-Host "  [missing] $file"
  }
}

Write-Host ""
Write-Host "Checking skill frontmatter..."
$skillPath = Join-Path $PackRoot "SKILL.md"
$skillText = Get-Content -LiteralPath $skillPath -Raw -Encoding UTF8
if ($skillText -match '(?m)^name:\s*axure-analyzer\s*$') {
  Write-Host "  [ok] name: axure-analyzer"
} else {
  Write-Host "  [invalid] name must be 'axure-analyzer' (lowercase, matches directory)"
}
$nestedSkills = Get-ChildItem -LiteralPath (Join-Path $PackRoot "node_modules") -Recurse -Filter "SKILL.md" -ErrorAction SilentlyContinue
if ($nestedSkills) {
  Write-Host "  [invalid] nested SKILL.md found under node_modules (run scripts/strip-node-modules-skills.js)"
} else {
  Write-Host "  [ok] no nested SKILL.md under node_modules"
}

Write-Host ""
Write-Host "Checking dependencies..."
Push-Location $PackRoot
try {
  node -e "require('playwright-core'); console.log('  [ok] playwright-core')"
} catch {
  Write-Host "  [missing] playwright-core (run: npm install)"
}
Pop-Location

Write-Host ""
Write-Host "Checking optional OCR dependency..."
try {
  python -c "import rapidocr_onnxruntime; print('  [ok] rapidocr_onnxruntime')"
} catch {
  Write-Host "  [missing] rapidocr_onnxruntime (run: python -m pip install rapidocr_onnxruntime)"
}

if ($SampleInput) {
  Write-Host ""
  Write-Host "Running render smoke test for: $Page"
  node (Join-Path $PackRoot "scripts\render_pages.js") `
    --input $SampleInput `
    --output (Join-Path $PackRoot "output\verify") `
    --pages $Page `
    --no-screenshot
}

Write-Host ""
Write-Host "Verification complete."
