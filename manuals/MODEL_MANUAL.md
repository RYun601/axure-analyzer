# Model Manual: Axure Published HTML Prototype Workflow

Use this pack when the user provides an Axure RP published HTML export, a local `html_export` folder, a directory containing `data/document.js`, or asks to turn a prototype into requirements, PRD, page specs, handoff docs, or implementation context.

## Mandatory Skill Routing

Load or follow these skills:

1. `axure-rp-html-ingest`
2. `axure-requirements-doc-writer`

Use `axure-rp-html-ingest` first unless `extracted/axure_context.json` already exists and is current.

Use `axure-requirements-doc-writer` when writing PRD, requirements, module descriptions, functional specs, handoff documents, or test-case drafts.

## Default Mode

Default to `static-prototype`.

Do not switch to `strict` unless the user explicitly asks for strict Axure interaction extraction or says the Axure interactions are formal source-of-truth.

In `static-prototype`, treat Axure as static business interface material:

- Strong signals: sitemap, page names, module folders, visible text, labels, placeholders, button-like text, input controls, list/table presence.
- Weak signals: interactionMap, dynamic panel states, repeater hints.
- Noise to suppress: empty labels, `State1`, empty targets, raw action names, empty dynamic panels, implementation-ish Axure internals.

Translate technical interaction hints into business wording:

- `setPanelState`: possible tab/state switch.
- `fadeWidget`: possible dialog or show/hide behavior.
- `linkWindow`: possible page navigation.
- `addSortToRepeater`: possible sort behavior.

## Script Locations

Assume the scripts are installed under the current project root:

```text
scripts/axure/ingest_axure_html.js
scripts/axure/make_axure_context_pack.js
scripts/axure/make_requirements_doc.js
```

If these scripts are missing, tell the user to install/copy the pack scripts into the project root.

## Core Commands

Parse an export:

```powershell
node scripts/axure/ingest_axure_html.js --input "<Axure HTML export root>"
```

Parse selected pages:

```powershell
node scripts/axure/ingest_axure_html.js --input "<Axure HTML export root>" --pages "登录,质检项"
```

Generate a requirements draft:

```powershell
node scripts/axure/make_requirements_doc.js `
  --input "<Axure HTML export root>" `
  --context "extracted/axure_context.json" `
  --mode static-prototype
```

Generate a module context pack:

```powershell
node scripts/axure/make_axure_context_pack.js `
  --context "extracted/axure_context.json" `
  --pages "页面1,页面2" `
  --task "当前任务说明" `
  --output "extracted/packs/<模块名>_context_pack.md"
```

## Output Contract

Write intermediate artifacts under:

```text
extracted/
extracted/pages/
extracted/packs/
```

Write final Markdown deliverables under:

```text
outputs/
```

Do not write into the Axure export input directory.

## Context Compression Strategy

When context may be compressed:

1. Keep `extracted/axure_context.json` as the durable source.
2. Use `extracted/axure_sitemap.md` for navigation.
3. Use `extracted/pages/<page>.md` for page-level reference.
4. Use `extracted/packs/<module>_context_pack.md` for task-local context.
5. Restate the current module, selected pages, and output target before continuing a long task.

Never paste the entire raw `data.js` into the conversation.

## Quality Bar

The final document should read like a requirements draft, not an Axure parser report.

Prefer:

- Module positioning from sitemap and page names.
- Page purpose from page title and meaningful labels.
- Form/filter/list/action summaries from visible controls.
- A small number of meaningful business confirmation items.

Avoid:

- Long dumps of component IDs.
- Raw Axure action names in the main document.
- Treating every missing table field as a major confirmation item.
- Claiming full semantic fidelity.
