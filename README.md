# Axure Prototype Skill Pack

Claude Code skills and Node.js scripts for parsing Axure RP published HTML prototypes and generating static-prototype requirements drafts.

## What It Does

1. **Parse** Axure RP HTML export packages into structured JSON and Markdown (sitemap, page components, interactions, dynamic panels, repeaters, text hints)
2. **Generate** per-module context packs for LLM consumption
3. **Produce** business-oriented requirements documents from parsed prototypes

Default mode is `static-prototype` — treats Axure as static business interface material rather than formal interaction specs. This matches how most real-world Axure prototypes are actually used.

## Quick Start

### Install Skills

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProjectRoot "D:\YourProject"
```

This installs two Claude Code skills to `~/.claude/skills/` and copies scripts to your project's `scripts/axure/` directory.

### Verify Installation

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1 -ProjectRoot "D:\YourProject"
```

### Use in Claude Code

Place your Axure HTML export in your project, then ask Claude Code:

```
请分析 inputs/html_export 下的 Axure RP HTML 原型，默认按 static-prototype 模式生成需求文档。
先解析原型，再输出 outputs/<项目名>_需求文档.md。
```

### Run Scripts Manually

```powershell
# Parse Axure export
node scripts/axure/ingest_axure_html.js --input "path/to/html_export"

# Generate requirements document
node scripts/axure/make_requirements_doc.js `
  --input "path/to/html_export" `
  --context "extracted/axure_context.json" `
  --mode static-prototype

# Generate module context pack
node scripts/axure/make_axure_context_pack.js `
  --context "extracted/axure_context.json" `
  --pages "页面1,页面2" `
  --task "任务描述" `
  --output "extracted/packs/module_context_pack.md"
```

## Skills

### axure-rp-html-ingest

Parses Axure RP HTML export packages into structured context. Produces `axure_context.json`, sitemap, and per-page summaries.

**Trigger phrases**: Axure, RP, published HTML prototype, html_export, data/document.js, prototype structure extraction

### axure-requirements-doc-writer

Converts parsed Axure prototypes into structured requirements documents (PRD, functional specs, test cases). Depends on `axure-rp-html-ingest` output.

**Trigger phrases**: PRD, requirements draft, module requirements, functional specs, page specifications, test cases, handoff document

## Output Structure

```
extracted/
├── axure_context.json          # Complete structured context
├── axure_sitemap.md            # Human-readable sitemap
├── pages/
│   ├── <pageName>.json         # Per-page detailed JSON
│   └── <pageName>.md           # Per-page Markdown summary
└── packs/
    └── <module>_context_pack.md # Per-module context packs

outputs/
└── <project>_<docType>.md      # Generated requirements document
```

## Modes

| Mode | Description |
|------|-------------|
| `static-prototype` (default) | Treats Axure as static business interface material. Suppresses technical noise (empty labels, State1, raw action names). Produces business-oriented requirements drafts. |
| `strict` | Treats Axure as formal interaction specification. Full extraction of all interaction rules, component details, and confirmation items. |

## Requirements

- Node.js >= 16
- No external npm dependencies (uses only Node.js built-in modules)

## Project Structure

```
axure-prototype-skill-pack/
├── config/
│   └── global-prototype-analysis.jsonc   # Optional category routing config
├── manuals/
│   ├── HUMAN_MANUAL.md                   # Human-facing usage guide
│   └── MODEL_MANUAL.md                   # AI model behavior guide
├── scripts/axure/
│   ├── ingest_axure_html.js              # Core Axure HTML parser
│   ├── make_axure_context_pack.js        # Context pack generator
│   └── make_requirements_doc.js          # Requirements document generator
├── skills/
│   ├── axure-rp-html-ingest/SKILL.md     # Claude Code skill definition
│   └── axure-requirements-doc-writer/SKILL.md
├── install.ps1                           # Installation script
├── verify.ps1                            # Verification script
├── manifest.json                         # Package metadata
└── README.md
```

## Compatibility

Works with Claude Code, CodeFree, and any AI assistant that supports the Claude Code skill format (SKILL.md in `~/.claude/skills/`).

## License

MIT
