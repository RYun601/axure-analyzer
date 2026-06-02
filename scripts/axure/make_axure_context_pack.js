#!/usr/bin/env node
/**
 * make_axure_context_pack.js
 *
 * Generate a lightweight context pack from extracted Axure context,
 * scoped to specific pages and a task description.
 *
 * Usage:
 *   node make_axure_context_pack.js \
 *     --context <axure_context.json> \
 *     --pages <页面名1,页面名2> \
 *     --task "<任务描述>" \
 *     --output <context-pack.md>
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    context: null,
    pages: null,
    task: '',
    output: null,
    sitemapMode: 'compact',
    noEmoji: true,
    maxChars: 12000,
    resumeHeader: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--context':
        args.context = argv[++i];
        break;
      case '--pages':
        args.pages = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--task':
        args.task = argv[++i] || '';
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--sitemap-mode':
        args.sitemapMode = argv[++i] || 'compact';
        if (!['full', 'compact', 'none'].includes(args.sitemapMode)) {
          console.error(`ERROR: --sitemap-mode must be full|compact|none, got: ${args.sitemapMode}`);
          process.exit(1);
        }
        break;
      case '--no-emoji':
        args.noEmoji = true;
        break;
      case '--emoji':
        args.noEmoji = false;
        break;
      case '--max-chars':
        args.maxChars = parseInt(argv[++i], 10);
        if (isNaN(args.maxChars) || args.maxChars < 1000) {
          console.error('ERROR: --max-chars must be a number >= 1000');
          process.exit(1);
        }
        break;
      case '--resume-header':
        args.resumeHeader = true;
        break;
      default:
        console.warn(`Unknown argument: ${argv[i]}`);
    }
  }

  const missing = [];
  if (!args.context) missing.push('--context');
  if (!args.pages || args.pages.length === 0) missing.push('--pages');
  if (!args.output) missing.push('--output');

  if (missing.length > 0) {
    console.error(`ERROR: Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: node make_axure_context_pack.js --context <json> --pages <p1,p2> --task "<desc>" --output <md>');
    process.exit(1);
  }

  return args;
}

// ============================================================================
// Context Loading
// ============================================================================

function loadContext(contextPath) {
  const resolved = path.resolve(contextPath);
  if (!fs.existsSync(resolved)) {
    console.error(`FATAL: Context file not found: ${resolved}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    console.error(`FATAL: Failed to parse context JSON: ${e.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Page Selection
// ============================================================================

function selectPages(ctx, requestedPages) {
  const availableNames = ctx.pages.map(p => p.pageName);
  const found = [];
  const missing = [];

  for (const name of requestedPages) {
    const page = ctx.pages.find(p => p.pageName === name);
    if (page) {
      found.push(page);
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    console.error(`ERROR: Pages not found in context: ${missing.join(', ')}`);
    console.error('Available pages:');
    availableNames.forEach(n => console.error(`  - ${n}`));
    process.exit(1);
  }

  return found;
}

// ============================================================================
// Sitemap Summary
// ============================================================================

function buildSitemapSummary(ctx, selectedPageNames, sitemapMode, noEmoji) {
  if (sitemapMode === 'none') return '';

  const sitemap = ctx.document.sitemap;
  const folders = sitemap.filter(e => e.type === 'Folder');
  const pages = sitemap.filter(e => e.type === 'Wireframe');

  const folderIcon = noEmoji ? '[Folder]' : '📁';
  const pageIcon = noEmoji ? '[Page]' : '📄';

  let md = '';
  md += `The project contains **${pages.length} pages** in **${folders.length} folders**.\n\n`;

  if (sitemapMode === 'compact') {
    // Compact: only depth 0-1, plus the branch containing selected pages
    // First, find the paths to selected pages in the sitemap tree
    const selectedSet = new Set(selectedPageNames);

    // Build parent-child map to trace ancestry
    const entryByIdx = sitemap.map((e, i) => ({ ...e, idx: i }));
    // Find indices of selected pages
    const selectedIndices = new Set();
    for (const entry of entryByIdx) {
      if (entry.type === 'Wireframe' && selectedSet.has(entry.pageName)) {
        selectedIndices.add(entry.idx);
      }
    }

    // Trace ancestors: walk backwards to find parent folders at each depth
    // A simple approach: include entries at depth 0-1, plus entries on the path to selected pages
    const includedIndices = new Set();
    for (let i = 0; i < sitemap.length; i++) {
      const entry = sitemap[i];
      // Always include depth 0 and 1
      if (entry.depth <= 1) {
        includedIndices.add(i);
      }
    }

    // For selected pages, include their ancestor chain and siblings in the same folder
    for (const selIdx of selectedIndices) {
      const selEntry = sitemap[selIdx];
      // Walk backwards to find ancestor folders
      let ancestorDepth = selEntry.depth - 1;
      for (let i = selIdx - 1; i >= 0 && ancestorDepth >= 0; i--) {
        if (sitemap[i].depth === ancestorDepth && sitemap[i].type === 'Folder') {
          includedIndices.add(i);
          // Include all entries between this folder and the next folder at same depth
          for (let j = i + 1; j < sitemap.length; j++) {
            if (sitemap[j].depth <= ancestorDepth) break;
            if (sitemap[j].depth === ancestorDepth + 1) {
              includedIndices.add(j);
            }
          }
          ancestorDepth--;
        }
      }
      // Include the selected page itself
      includedIndices.add(selIdx);
    }

    md += '```\n';
    let lastIncludedDepth = -1;
    for (let i = 0; i < sitemap.length; i++) {
      if (!includedIndices.has(i)) continue;
      const entry = sitemap[i];
      const indent = '  '.repeat(entry.depth);
      const icon = entry.type === 'Folder' ? folderIcon : pageIcon;
      const suffix = entry.url ? ` -> ${entry.url}` : '';
      md += `${indent}${icon} ${entry.pageName}${suffix}\n`;
    }
    md += '```\n';
  } else {
    // full mode
    md += '```\n';
    for (const entry of sitemap) {
      const indent = '  '.repeat(entry.depth);
      const icon = entry.type === 'Folder' ? folderIcon : pageIcon;
      const suffix = entry.url ? ` -> ${entry.url}` : '';
      md += `${indent}${icon} ${entry.pageName}${suffix}\n`;
    }
    md += '```\n';
  }

  return md;
}

// ============================================================================
// Page Section Builders
// ============================================================================

function buildPageOverview(pages) {
  let md = '';
  for (const page of pages) {
    md += `### ${page.pageName}\n\n`;
    md += `- **URL**: ${page.url || 'N/A'}\n`;
    md += `- **Components**: ${page.stats.componentCount}\n`;
    md += `- **Interactions**: ${page.stats.interactionCount}\n`;
    md += `- **Dynamic Panels**: ${page.stats.dynamicPanelCount}\n`;
    md += `- **Repeaters**: ${page.stats.repeaterCount}\n`;
    md += `- **Tables**: ${page.stats.tableCount}\n\n`;
  }
  return md;
}

function buildKeyComponents(pages, maxChars = Infinity) {
  let md = '';

  for (const page of pages) {
    const components = page.components;
    if (components.length === 0) {
      md += `### ${page.pageName}\n\n_No components_\n\n`;
      continue;
    }

    md += `### ${page.pageName}\n\n`;

    // Group by friendlyType for summary
    const typeCounts = {};
    for (const c of components) {
      const ft = c.friendlyType || c.type || 'unknown';
      typeCounts[ft] = (typeCounts[ft] || 0) + 1;
    }

    md += '**Type summary**: ';
    md += Object.entries(typeCounts).map(([t, n]) => `${t}(${n})`).join(', ');
    md += '\n\n';

    // List labeled components (most useful for LLM context)
    // Deduplicate by label+type for compactness
    const labeled = components.filter(c => c.label);
    const seenLabelType = new Set();
    const dedupedLabeled = [];
    for (const c of labeled) {
      const key = `${c.label}|${c.friendlyType || c.type}`;
      if (!seenLabelType.has(key)) {
        seenLabelType.add(key);
        dedupedLabeled.push(c);
      }
    }

    if (dedupedLabeled.length > 0) {
      md += '| Label | Type | Visible | Placeholder |\n';
      md += '|-------|------|---------|-------------|\n';
      for (const c of dedupedLabeled.slice(0, 40)) {
        md += `| ${c.label} | ${c.friendlyType || c.type} | ${c.visible ? 'Yes' : 'No'} | ${c.placeholderText || '-'} |\n`;
      }
      if (dedupedLabeled.length > 40) {
        md += `\n_Showing 40 of ${dedupedLabeled.length} unique labeled components (deduped from ${labeled.length} total)_\n`;
      } else if (dedupedLabeled.length < labeled.length) {
        md += `\n_${dedupedLabeled.length} unique labeled components (deduped from ${labeled.length} total)_\n`;
      }
    } else {
      md += '_No labeled components_\n';
    }
    md += '\n';
  }

  return md;
}

function buildDynamicPanels(pages) {
  let md = '';

  for (const page of pages) {
    const panels = page.dynamicPanels;
    if (panels.length === 0) continue;

    md += `### ${page.pageName}\n\n`;
    md += '| Label | States |\n';
    md += '|-------|--------|\n';
    for (const dp of panels) {
      md += `| ${dp.label || '(unnamed)'} | ${dp.stateLabels.join(', ')} (${dp.stateCount}) |\n`;
    }
    md += '\n';
  }

  if (!md) md = '_No dynamic panels in selected pages_\n\n';
  return md;
}

function buildRepeatersAndTables(pages) {
  let md = '';

  const hasRepeaters = pages.some(p => p.repeaters && p.repeaters.length > 0);
  const hasTables = pages.some(p => p.tables && p.tables.length > 0);

  if (!hasRepeaters && !hasTables) {
    return '_No repeaters or tables in selected pages_\n\n';
  }

  for (const page of pages) {
    const repeaters = page.repeaters || [];
    const tables = page.tables || [];
    if (repeaters.length === 0 && tables.length === 0) continue;

    md += `### ${page.pageName}\n\n`;

    if (repeaters.length > 0) {
      md += '**Repeaters**:\n\n';
      md += '| Label | Rows | Columns |\n';
      md += '|-------|------|---------|\n';
      for (const r of repeaters) {
        md += `| ${r.label || '(unnamed)'} | ${r.rowCount} | ${r.columnNames.join(', ') || '-'} |\n`;
      }
      md += '\n';
    }

    if (tables.length > 0) {
      md += '**Tables**:\n\n';
      md += '| Label | Rows | Cols | Column Labels |\n';
      md += '|-------|------|------|---------------|\n';
      for (const t of tables) {
        md += `| ${t.label || '(unnamed)'} | ${t.rowCount} | ${t.columnCount} | ${t.columnLabels.join(', ') || '-'} |\n`;
      }
      md += '\n';
    }
  }

  return md;
}

function buildInteractionRules(pages) {
  let md = '';

  for (const page of pages) {
    const interactions = page.interactions;
    if (interactions.length === 0) continue;

    md += `### ${page.pageName}\n\n`;

    // Deduplicate by (sourceLabel, eventType, action, target) for compactness
    const seen = new Set();
    const deduped = [];
    for (const i of interactions) {
      const key = `${i.sourceLabel}|${i.eventType}|${i.action}|${i.target}|${i.conditionString}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(i);
      }
    }

    md += '| Source | Event | Condition | Action | Target | Description |\n';
    md += '|--------|-------|-----------|--------|--------|-------------|\n';
    for (const i of deduped.slice(0, 60)) {
      const source = i.sourceLabel || i.sourceId.substring(0, 8);
      const condition = i.conditionString || '-';
      const desc = i.description || '-';
      md += `| ${source} | ${i.eventType} | ${condition} | ${i.action} | ${i.target || '-'} | ${desc} |\n`;
    }
    if (deduped.length > 60) {
      md += `\n_Showing 60 of ${deduped.length} unique interactions (deduped from ${interactions.length} total)_\n`;
    } else {
      md += `\n_${deduped.length} unique interactions (deduped from ${interactions.length} total)_\n`;
    }
    md += '\n';
  }

  if (!md) md = '_No interactions in selected pages_\n\n';
  return md;
}

function buildEvidencePaths(pages, contextPath) {
  let md = '';
  const ctxDir = path.dirname(path.resolve(contextPath));

  md += '- **Context JSON**: `' + contextPath + '`\n';
  for (const page of pages) {
    const safeName = page.pageName.replace(/[<>:"/\\|?*]/g, '_');
    md += `- **${page.pageName}**:\n`;
    md += `  - JSON: \`${path.join(ctxDir, 'pages', safeName + '.json')}\`\n`;
    md += `  - Markdown: \`${path.join(ctxDir, 'pages', safeName + '.md')}\`\n`;
    md += `  - Original data.js: \`${page.dataJsPath}\`\n`;
    md += `  - Original HTML: \`${page.htmlPath}\`\n`;
  }

  return md;
}

function buildConstraints() {
  let md = '';
  md += '- 不要读取原始 data.js，除非摘要不足\n';
  md += '- 不要臆造未提取到的交互\n';
  md += '- 优先使用页面摘要和 axure_context.json 中相关页面节点\n';
  md += '- 如需更多细节，按 Evidence Paths 中的路径查找对应页面 JSON/Markdown\n';
  md += '- 对无法确认的内容标为"低置信度"或"需人工确认"\n';
  return md;
}

// ============================================================================
// HTML Text Hints
// ============================================================================

function buildHtmlTextHints(pages, maxVisibleTexts = 10) {
  let md = '';

  for (const page of pages) {
    const hints = page.htmlTextHints;
    if (!hints || hints.length === 0) continue;

    md += `### ${page.pageName}\n\n`;

    // Group by type
    const placeholders = hints.filter(h => h.type === 'placeholder').map(h => h.value);
    const visibleTexts = hints.filter(h => h.type === 'visibleText').map(h => h.value);
    const hiddenCount = hints.find(h => h.type === 'hiddenCount');

    if (placeholders.length > 0) {
      md += `**Placeholders**: ${placeholders.join(', ')}\n\n`;
    }
    if (visibleTexts.length > 0) {
      md += `**Visible texts**: ${visibleTexts.slice(0, maxVisibleTexts).join(', ')}`;
      if (visibleTexts.length > maxVisibleTexts) md += ` ... (+${visibleTexts.length - maxVisibleTexts} more)`;
      md += '\n\n';
    }
    if (hiddenCount) {
      md += `**Hidden nodes**: ${hiddenCount.value}\n\n`;
    }
  }

  if (!md) md = '_No HTML text hints in selected pages_\n\n';
  return md;
}

// ============================================================================
// Trimming (for --max-chars)
// ============================================================================

/**
 * Trim markdown content to fit within maxChars.
 * Priority: trim sitemap > trim Key Components (dedup labels) > trim HTML visible texts.
 * NEVER trim: Interaction Rules, Dynamic Panels, Evidence Paths, Constraints.
 */
function trimToMaxChars(md, maxChars) {
  if (md.length <= maxChars) return md;

  // Strategy: find section boundaries and progressively shrink trimmable sections.
  // Sections that are trimmable: sitemap, Key Components, HTML Text Hints
  // Sections that are NOT trimmable: Interaction Rules, Dynamic Panels, Evidence Paths, Constraints

  const sectionRegex = /^## /gm;
  const sections = [];
  let match;
  while ((match = sectionRegex.exec(md)) !== null) {
    sections.push({ start: match.index, header: md.substring(match.index, match.index + 80) });
  }

  // Find trimmable section indices
  const trimmableNames = ['Project Sitemap Summary', 'Key Components', 'HTML Text Hints'];
  const trimmableSections = sections.filter(s =>
    trimmableNames.some(name => s.header.includes(name))
  );

  // If no trimmable sections found, just truncate with a note
  if (trimmableSections.length === 0) {
    const truncated = md.substring(0, maxChars - 50);
    return truncated + '\n\n_[Context pack trimmed to fit char limit]_\n';
  }

  // Progressive trimming approach:
  // 1. Remove sitemap entirely if present
  // 2. Reduce Key Components to type summary only (remove table)
  // 3. Remove HTML visible texts entirely

  let result = md;

  // Pass 1: Remove sitemap section content (replace with one-liner)
  for (const sec of trimmableSections) {
    if (!sec.header.includes('Project Sitemap Summary')) continue;
    // Find end of this section (next ## or end of file)
    const nextSection = sections.find(s => s.start > sec.start);
    const endIdx = nextSection ? nextSection.start : result.length;
    const originalContent = result.substring(sec.start, endIdx);
    const replacement = '## Project Sitemap Summary\n\n_(Sitemap omitted to fit char limit)_\n\n';
    result = result.substring(0, sec.start) + replacement + result.substring(endIdx);
    break; // Only do this once
  }

  if (result.length <= maxChars) return result;

  // Pass 2: Trim Key Components - remove the table, keep type summary
  const kcSection = sections.find(s => s.header.includes('Key Components'));
  if (kcSection) {
    const nextSection = sections.find(s => s.start > kcSection.start);
    const endIdx = nextSection ? nextSection.start : result.length;
    const kcContent = result.substring(kcSection.start, endIdx);

    // Replace component tables with just type summaries
    let trimmedKc = '';
    const pageSections = kcContent.split(/^### /m);
    for (let i = 0; i < pageSections.length; i++) {
      if (i === 0) {
        trimmedKc += pageSections[i];
        continue;
      }
      const pageContent = pageSections[i];
      // Extract page name (first line) and type summary
      const lines = pageContent.split('\n');
      const pageName = lines[0];
      const typeSummaryLine = lines.find(l => l.startsWith('**Type summary**'));
      trimmedKc += `### ${pageName}\n\n`;
      if (typeSummaryLine) {
        trimmedKc += `${typeSummaryLine}\n\n_(Component table omitted to fit char limit)_\n\n`;
      } else {
        trimmedKc += '_(Component details omitted to fit char limit)_\n\n';
      }
    }
    result = result.substring(0, kcSection.start) + trimmedKc + result.substring(endIdx);
  }

  if (result.length <= maxChars) return result;

  // Pass 3: Remove HTML visible texts
  const htmlSection = sections.find(s => s.header.includes('HTML Text Hints'));
  if (htmlSection) {
    const nextSection = sections.find(s => s.start > htmlSection.start);
    const endIdx = nextSection ? nextSection.start : result.length;
    const replacement = '## HTML Text Hints\n\n_(HTML text hints omitted to fit char limit)_\n\n';
    result = result.substring(0, htmlSection.start) + replacement + result.substring(endIdx);
  }

  if (result.length <= maxChars) return result;

  // Final fallback: truncate
  const truncated = result.substring(0, maxChars - 50);
  return truncated + '\n\n_[Context pack trimmed to fit char limit]_\n';
}

// ============================================================================
// Resume Header
// ============================================================================

function buildResumeHeader() {
  let md = '';
  md += '> **压缩上下文续接说明**\n';
  md += '>\n';
  md += '> 本文件是从 Axure RP HTML 导出包解析得到的任务上下文包。\n';
  md += '> 不要重新读取原始 data.js，除非本摘要不足。\n';
  md += '> 优先依据 Selected Pages、Interaction Rules、Evidence Paths 执行任务。\n';
  md += '> 未提取到的交互不得臆造，需标记为低置信度或需人工确认。\n\n';
  return md;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = parseArgs(process.argv);

  console.log('=== Axure Context Pack Generator ===');
  console.log(`Context:      ${args.context}`);
  console.log(`Pages:        ${args.pages.join(', ')}`);
  console.log(`Task:         ${args.task || '(none)'}`);
  console.log(`Output:       ${args.output}`);
  console.log(`Sitemap mode: ${args.sitemapMode}`);
  console.log(`No emoji:     ${args.noEmoji}`);
  console.log(`Max chars:    ${args.maxChars}`);
  console.log(`Resume header: ${args.resumeHeader}`);
  console.log('');

  // Load context
  const ctx = loadContext(args.context);
  console.log(`Loaded context: ${ctx.pages.length} pages, ${ctx.document.sitemap.length} sitemap entries`);

  // Select pages
  const selectedPages = selectPages(ctx, args.pages);
  const selectedPageNames = args.pages;
  console.log(`Selected ${selectedPages.length} pages`);

  // Build context pack markdown
  let md = '';

  md += '# Axure Context Pack\n\n';

  // Resume header (if requested)
  if (args.resumeHeader) {
    md += buildResumeHeader();
  }

  // Task
  md += '## Task\n\n';
  md += `${args.task || '(No task description provided)'}\n\n`;

  // Project Sitemap Summary
  const sitemapMd = buildSitemapSummary(ctx, selectedPageNames, args.sitemapMode, args.noEmoji);
  if (sitemapMd) {
    md += '## Project Sitemap Summary\n\n';
    md += sitemapMd;
  }

  // Selected Pages
  md += '## Selected Pages\n\n';
  md += buildPageOverview(selectedPages);

  // Key Components
  md += '## Key Components\n\n';
  md += buildKeyComponents(selectedPages);

  // Dynamic Panels
  md += '## Dynamic Panels\n\n';
  md += buildDynamicPanels(selectedPages);

  // Repeaters and Tables
  md += '## Repeaters and Tables\n\n';
  md += buildRepeatersAndTables(selectedPages);

  // Interaction Rules
  md += '## Interaction Rules\n\n';
  md += buildInteractionRules(selectedPages);

  // HTML Text Hints
  md += '## HTML Text Hints\n\n';
  md += buildHtmlTextHints(selectedPages, 10);

  // Evidence Paths
  md += '## Evidence Paths\n\n';
  md += buildEvidencePaths(selectedPages, args.context);

  // Constraints
  md += '## Constraints\n\n';
  md += buildConstraints();

  // Trim to max chars
  const preTrimChars = md.length;
  md = trimToMaxChars(md, args.maxChars);
  const postTrimChars = md.length;
  if (preTrimChars !== postTrimChars) {
    console.log(`Trimmed: ${preTrimChars} -> ${postTrimChars} chars (limit: ${args.maxChars})`);
  }

  // Stats
  const charCount = md.length;
  const chineseChars = (md.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (md.match(/[a-zA-Z]+/g) || []).length;
  const estimatedWords = chineseChars + englishWords;
  console.log(`Generated context pack: ~${estimatedWords} words (${charCount} chars)`);

  // Write output
  const outputPath = path.resolve(args.output);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, md, 'utf-8');
  console.log(`Written: ${outputPath}`);

  console.log('\n=== Context Pack Generation Complete ===');
}

main();
