---
name: axure-rp-html-ingest
description: MUST USE when the task mentions Axure, RP, published HTML prototype, html_export, index.html prototype packages, data/document.js, files/*/data.js, extracting prototype structure, or converting prototype pages into LLM-ready context. Ingest and parse Axure RP exported HTML prototypes into structured JSON and Markdown.
---

# axure-rp-html-ingest

Parse Axure RP HTML export packages into structured context suitable for LLM consumption. Produces JSON and Markdown outputs including sitemap, page components, interactions, dynamic panels, repeaters, and HTML text hints.

---

## When to Use

- User provides an Axure RP local HTML export directory (contains `data/document.js`, `files/*/data.js`, page HTML files)
- User provides a published/static HTML prototype directory that looks like an Axure export, even if they do not explicitly say "Axure"
- User wants to convert Axure prototypes into structured data for LLM context injection
- User wants to analyze Axure prototype structure (sitemap, components, interactions)
- User wants to generate documentation from Axure prototypes

## Input

- **Required**: Path to Axure RP HTML export root directory
- The directory must contain `data/document.js`
- `files/<pageName>/data.js` and `<pageName>.html` are optional but recommended

## Output

All output goes to the `extracted/` directory (configurable via `--output`):

```
extracted/
├── axure_context.json          # Complete structured context
├── axure_sitemap.md            # Human-readable sitemap
├── pages/
│   ├── <pageName>.json         # Per-page detailed JSON
│   └── <pageName>.md           # Per-page Markdown summary
└── logs/
    └── runs/
        └── axure_ingest_<timestamp>.json  # Run log
```

---

## Core Workflow

```
1. Run: node ${CLAUDE_SKILL_DIR}/../../scripts/axure/ingest_axure_html.js --input <export-root> [--output <output-root>] [--max-pages N] [--pages p1,p2] [--dry-run]
2. Read extracted/axure_context.json for structured data
3. Read extracted/axure_sitemap.md for sitemap overview
4. Read extracted/pages/<pageName>.md for per-page summaries
```

---

## Script: ingest_axure_html.js

### CLI Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--input` | Yes | - | Axure HTML export root directory |
| `--output` | No | `extracted` | Output root directory |
| `--max-pages` | No | all | Maximum number of pages to process |
| `--pages` | No | all | Comma-separated page names to process |
| `--dry-run` | No | false | Print plan and stats without writing files |

### Processing Pipeline

```
1. Validate input directory (data/document.js must exist)
2. Load document.js via vm sandbox → extract sitemap, globalVariables
3. For each page in sitemap:
   a. Load files/<pageName>/data.js via vm sandbox → extract page object
   b. Parse page object → components, dynamicPanels, repeaters, interactions
   c. Load <pageName>.html → extract text hints, data-labels, placeholders
4. Generate output files (JSON + Markdown)
5. Write run log
```

---

## Safety Constraints (MANDATORY)

1. **Read-only on input**: Never modify the Axure HTML export package
2. **No network requests**: All processing is local
3. **vm sandbox only**: Node.js `vm` module is used solely to capture `$axure.loadDocument` / `$axure.loadCurrentPage` parameters
4. **No binary content**: resources, plugins, images are summarized (count/size), not included verbatim
5. **Chinese path support**: All file operations must handle Chinese characters in paths

---

## Failure Handling

| Condition | Behavior |
|-----------|----------|
| Missing `data/document.js` | FAIL with clear error message |
| Missing `files/*/data.js` | Output sitemap only, skip page details |
| Single page data.js parse error | Skip that page, record error in `errors[]` |
| Missing page HTML | Skip HTML text hints for that page |
| vm sandbox execution error | Catch and record, continue with next page |

---

## Output Format: axure_context.json

```json
{
  "sourceRoot": "...",
  "generatedAt": "ISO-8601",
  "document": {
    "sitemap": [
      { "depth": 0, "pageName": "...", "type": "Wireframe|Folder", "url": "..." }
    ],
    "globalVariables": {},
    "additionalJs": [],
    "additionalCss": []
  },
  "pages": [
    {
      "pageName": "...",
      "url": "...",
      "dataJsPath": "...",
      "htmlPath": "...",
      "stats": {
        "objectCount": 0,
        "interactionCount": 0,
        "componentCount": 0,
        "dynamicPanelCount": 0,
        "repeaterCount": 0
      },
      "components": [
        {
          "id": "...",
          "label": "...",
          "friendlyType": "...",
          "type": "...",
          "styleType": "...",
          "visible": true,
          "placeholderText": "..."
        }
      ],
      "dynamicPanels": [
        {
          "id": "...",
          "label": "...",
          "stateLabels": ["State1"],
          "stateCount": 1
        }
      ],
      "repeaters": [
        {
          "id": "...",
          "label": "...",
          "dataSummary": "...",
          "rowCount": 0,
          "columnNames": []
        }
      ],
      "interactions": [
        {
          "sourceId": "...",
          "sourceLabel": "...",
          "sourceFriendlyType": "...",
          "event": "...",
          "eventType": "...",
          "conditionString": "...",
          "action": "...",
          "displayName": "...",
          "description": "...",
          "target": "..."
        }
      ],
      "htmlTextHints": [
        { "type": "dataLabel", "value": "..." },
        { "type": "visibleText", "value": "..." },
        { "type": "placeholder", "value": "..." },
        { "type": "hiddenCount", "value": 0 }
      ]
    }
  ],
  "errors": []
}
```

---

## Output Format: axure_sitemap.md

```markdown
# Axure Sitemap

- PageName -> PageName.html
- FolderName
  - ChildPage -> ChildPage.html
    - GrandchildPage -> GrandchildPage.html
```

---

## Output Format: pages/<pageName>.md

```markdown
# Page: <pageName>

## Basic Info
- URL: ...
- Generation Date: ...

## Component Type Statistics
| Type | Count |
|------|-------|
| 矩形 | 5 |
| 动态面板 | 2 |

## Main Components
| ID | Label | Type | Visible | Placeholder |
|----|-------|------|---------|-------------|

## Dynamic Panels
| ID | Label | States |
|----|-------|--------|

## Repeaters
| ID | Label | Rows | Columns |
|----|-------|------|---------|

## Interaction Rules
| Source | Event | Condition | Action | Target |
|--------|-------|-----------|--------|--------|

## HTML Visible Text Hints
- data-label: ...
- Visible text: ...
- Placeholder: ...

## Parse Warnings
- [Low confidence] ...
```

---

## Common Pitfalls

| Pitfall | Correct Approach |
|---------|-----------------|
| Modifying Axure export files | Read-only access to input directory |
| Including raw data.js content in output | Extract and summarize; never dump raw JS |
| Claiming 100% Axure semantic fidelity | Mark uncertain content as "low confidence" or "needs manual confirmation" |
| Ignoring Chinese paths | Use `fs.readFileSync` with proper encoding; test with Chinese directory names |
| Treating vm sandbox as secure execution | Only capture `$axure.loadDocument`/`$axure.loadCurrentPage` params |
| Processing all pages on huge projects | Use `--max-pages` and `--pages` to limit scope |

---

## Future Extensions (NOT implemented yet)

- **Page Summarizer**: Generate LLM-optimized page summaries with layout analysis
- **Context Injector**: Inject extracted context into AI assistant conversation flow
- **Diff Mode**: Compare two Axure export versions and highlight changes
