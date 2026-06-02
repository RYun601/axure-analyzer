#!/usr/bin/env node
/**
 * ingest_axure_html.js
 * 
 * Parse Axure RP HTML export packages into structured LLM-ready context.
 * 
 * Usage:
 *   node ingest_axure_html.js --input <export-root> [--output <output-root>] [--max-pages N] [--pages p1,p2] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    input: null,
    output: 'extracted',
    maxPages: Infinity,
    pages: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--max-pages':
        args.maxPages = parseInt(argv[++i], 10);
        break;
      case '--pages':
        args.pages = argv[++i].split(',').map(s => s.trim());
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        console.warn(`Unknown argument: ${argv[i]}`);
    }
  }

  if (!args.input) {
    console.error('ERROR: --input is required');
    process.exit(1);
  }

  return args;
}

// ============================================================================
// VM Sandbox: Load Axure JS files
// ============================================================================

/**
 * Load data/document.js via vm sandbox to capture the document object.
 * document.js calls $axure.loadDocument(...), so we provide a mock.
 */
function loadDocumentJs(inputRoot) {
  const docJsPath = path.join(inputRoot, 'data', 'document.js');
  if (!fs.existsSync(docJsPath)) {
    return { error: `Missing required file: ${docJsPath}`, data: null };
  }

  let captured = null;
  const sandbox = {
    $axure: {
      loadDocument: function(doc) {
        captured = doc;
      }
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  try {
    const code = fs.readFileSync(docJsPath, 'utf-8');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 10000 });
    return { error: null, data: captured };
  } catch (e) {
    return { error: `Failed to parse document.js: ${e.message}`, data: null };
  }
}

/**
 * Load files/<pageName>/data.js via vm sandbox to capture the page object.
 * data.js calls $axure.loadCurrentPage(...), so we provide a mock.
 */
function loadPageDataJs(inputRoot, pageName) {
  const dataJsPath = path.join(inputRoot, 'files', pageName, 'data.js');
  if (!fs.existsSync(dataJsPath)) {
    return { error: `Missing file: ${dataJsPath}`, data: null };
  }

  let captured = null;
  const sandbox = {
    $axure: {
      loadCurrentPage: function(page) {
        captured = page;
      }
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  try {
    const code = fs.readFileSync(dataJsPath, 'utf-8');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 10000 });
    return { error: null, data: captured };
  } catch (e) {
    return { error: `Failed to parse ${pageName}/data.js: ${e.message}`, data: null };
  }
}

// ============================================================================
// Document Extraction
// ============================================================================

/**
 * Flatten sitemap tree into a list with depth info.
 */
function flattenSitemap(rootNodes, depth = 0) {
  const result = [];
  if (!rootNodes || !Array.isArray(rootNodes)) return result;

  for (const node of rootNodes) {
    result.push({
      depth,
      pageName: node.pageName || '',
      type: node.type || '',
      url: node.url || '',
    });
    if (node.children && node.children.length > 0) {
      result.push(...flattenSitemap(node.children, depth + 1));
    }
  }
  return result;
}

/**
 * Extract document-level information.
 */
function extractDocument(docObj) {
  if (!docObj) return { sitemap: [], globalVariables: {}, additionalJs: [], additionalCss: [] };

  const sitemap = flattenSitemap(docObj.sitemap ? docObj.sitemap.rootNodes : []);

  // Extract globalVariables
  let globalVariables = {};
  if (docObj.globalVariables) {
    globalVariables = docObj.globalVariables;
  }

  // Extract additionalJs / additionalCss (summary only)
  const additionalJs = Array.isArray(docObj.additionalJs) 
    ? docObj.additionalJs.map(js => typeof js === 'string' ? path.basename(js) : String(js))
    : [];
  const additionalCss = Array.isArray(docObj.additionalCss)
    ? docObj.additionalCss.map(css => typeof css === 'string' ? path.basename(css) : String(css))
    : [];

  return { sitemap, globalVariables, additionalJs, additionalCss };
}

// ============================================================================
// Page Extraction
// ============================================================================

/**
 * Get the diagram object from a page object.
 * The vm-captured object has structure: { url, page: { diagram: { objects: [...] } }, ... }
 */
function getPageDiagram(pageObj) {
  if (!pageObj) return null;
  // The captured object from $axure.loadCurrentPage has page.diagram
  if (pageObj.page && pageObj.page.diagram) {
    return pageObj.page.diagram;
  }
  // Fallback: some structures may have diagram at top level
  if (pageObj.diagram) {
    return pageObj.diagram;
  }
  return null;
}

/**
 * Extract components from page objects.
 * Components are objects that are NOT dynamicPanel, table, or referenceDiagramObject.
 */
function extractComponents(pageObj) {
  const components = [];
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return components;

  function walkObjects(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      const friendlyType = obj.friendlyType || '';
      const type = obj.type || '';
      const styleType = obj.styleType || '';

      // Skip dynamic panels, tables, and template references - they have their own sections
      if (type === 'dynamicPanel' || type === 'table' || type === 'referenceDiagramObject') {
        // Still recurse into children
        if (obj.objs) walkObjects(obj.objs);
        if (obj.diagrams) {
          for (const diag of obj.diagrams) {
            if (diag.objects) walkObjects(diag.objects);
          }
        }
        continue;
      }

      components.push({
        id: obj.id || '',
        label: obj.label || '',
        friendlyType,
        type,
        styleType,
        visible: obj.visible !== false,
        placeholderText: obj.placeholderText || '',
      });

      // Recurse into children (layer/组合 objects)
      if (obj.objs) walkObjects(obj.objs);
    }
  }

  walkObjects(diagram.objects);
  return components;
}

/**
 * Extract dynamic panels from page objects.
 */
function extractDynamicPanels(pageObj) {
  const panels = [];
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return panels;

  function walkObjects(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      if (obj.type === 'dynamicPanel') {
        const stateLabels = [];
        if (obj.diagrams && Array.isArray(obj.diagrams)) {
          for (const diag of obj.diagrams) {
            stateLabels.push(diag.label || 'State1');
          }
        }
        panels.push({
          id: obj.id || '',
          label: obj.label || '',
          stateLabels,
          stateCount: stateLabels.length,
        });
      }
      // Recurse
      if (obj.objs) walkObjects(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) walkObjects(diag.objects);
        }
      }
    }
  }

  walkObjects(diagram.objects);
  return panels;
}

/**
 * Extract repeaters from page objects.
 * Repeaters have type "repeater" in Axure data.
 */
function extractRepeaters(pageObj) {
  const repeaters = [];
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return repeaters;

  function walkObjects(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      if (obj.type === 'repeater') {
        let dataSummary = '';
        let rowCount = 0;
        let columnNames = [];

        // Try to extract data info
        if (obj.data) {
          if (obj.data.list && Array.isArray(obj.data.list)) {
            rowCount = obj.data.list.length;
            if (rowCount > 0 && obj.data.list[0]) {
              columnNames = Object.keys(obj.data.list[0]);
            }
          }
          if (obj.data.dataProps) {
            dataSummary = typeof obj.data.dataProps === 'string' 
              ? obj.data.dataProps 
              : JSON.stringify(obj.data.dataProps).substring(0, 200);
          }
        }

        repeaters.push({
          id: obj.id || '',
          label: obj.label || '',
          dataSummary,
          rowCount,
          columnNames,
        });
      }
      // Recurse
      if (obj.objs) walkObjects(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) walkObjects(diag.objects);
        }
      }
    }
  }

  walkObjects(diagram.objects);
  return repeaters;
}

/**
 * Extract interactions from page objects.
 * Interactions are stored in interactionMap property on each object.
 * 
 * interactionMap structure:
 *   {
 *     "<eventKey>": {
 *       eventType: "OnClick",
 *       description: "...",
 *       cases: {
 *         "0": {
 *           description: "...",
 *           conditionString: "",
 *           actions: [
 *             { action: "setPanelState", ... },
 *             { action: "fadeWidget", ... },
 *             { action: "linkWindow", ... }
 *           ]
 *         }
 *       }
 *     }
 *   }
 */
function extractInteractions(pageObj) {
  const interactions = [];
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return interactions;

  // Build a lookup for object labels by id
  const objLookup = {};
  function buildLookup(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      objLookup[obj.id] = {
        label: obj.label || '',
        friendlyType: obj.friendlyType || '',
      };
      if (obj.objs) buildLookup(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) buildLookup(diag.objects);
        }
      }
    }
  }
  buildLookup(diagram.objects);

  // Walk objects and extract interactionMap
  function walkInteractions(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      if (obj.interactionMap && typeof obj.interactionMap === 'object') {
        for (const [eventKey, eventData] of Object.entries(obj.interactionMap)) {
          if (!eventData || typeof eventData !== 'object') continue;

          const eventType = eventData.eventType || eventKey;
          const eventDescription = eventData.description || '';

          // eventData has a "cases" object (not array), keyed by "0", "1", etc.
          if (eventData.cases && typeof eventData.cases === 'object') {
            for (const [caseKey, caseData] of Object.entries(eventData.cases)) {
              if (!caseData || typeof caseData !== 'object') continue;

              const caseDescription = caseData.description || '';
              const conditionString = cleanHtmlEntities(caseData.conditionString || '');
              const actions = caseData.actions;

              if (!Array.isArray(actions)) continue;

              for (const action of actions) {
                // Normalize target: if it's an object, extract meaningful info
                let targetStr = '';
                const rawTarget = action.target || action.targetId || '';
                if (typeof rawTarget === 'object' && rawTarget !== null) {
                  // e.g. { targetType: 'page', includeVariables: true }
                  targetStr = rawTarget.targetType 
                    ? `${rawTarget.targetType}${rawTarget.targetId ? ': ' + rawTarget.targetId : ''}${rawTarget.includeVariables ? ' (with vars)' : ''}`
                    : JSON.stringify(rawTarget);
                } else {
                  targetStr = String(rawTarget);
                }

                interactions.push({
                  sourceId: obj.id || '',
                  sourceLabel: objLookup[obj.id]?.label || obj.label || '',
                  sourceFriendlyType: objLookup[obj.id]?.friendlyType || obj.friendlyType || '',
                  event: eventKey,
                  eventType,
                  eventDescription,
                  caseKey,
                  caseDescription,
                  conditionString,
                  action: action.action || action.name || '',
                  displayName: action.displayName || '',
                  description: cleanHtmlEntities(action.description || ''),
                  target: targetStr,
                });
              }
            }
          }
        }
      }

      // Recurse
      if (obj.objs) walkInteractions(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) walkInteractions(diag.objects);
        }
      }
    }
  }

  walkInteractions(diagram.objects);
  return interactions;
}

/**
 * Extract tables from page objects.
 * Tables have type "table" in Axure data.
 */
function extractTables(pageObj) {
  const tables = [];
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return tables;

  function walkObjects(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      if (obj.type === 'table') {
        // Extract table structure info
        let rowCount = 0;
        let columnCount = 0;
        let columnLabels = [];

        if (obj.props && obj.props.columnCount) {
          columnCount = obj.props.columnCount;
        }
        if (obj.props && obj.props.rowCount) {
          rowCount = obj.props.rowCount;
        }
        // Try to get column labels from table cells or header row
        if (obj.objs && Array.isArray(obj.objs)) {
          // Look for header row objects
          for (const child of obj.objs) {
            if (child.type === 'tablecell' || child.friendlyType === 'Table Cell') {
              if (child.label && !columnLabels.includes(child.label)) {
                columnLabels.push(child.label);
              }
            }
          }
        }

        tables.push({
          id: obj.id || '',
          label: obj.label || '',
          rowCount,
          columnCount,
          columnLabels,
        });
      }
      // Recurse into children
      if (obj.objs) walkObjects(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) walkObjects(diag.objects);
        }
      }
    }
  }

  walkObjects(diagram.objects);
  return tables;
}

/**
 * Clean HTML entities and tags from a string.
 */
function cleanHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Count objects by type.
 */
function countObjectTypes(pageObj) {
  const counts = {};
  const diagram = getPageDiagram(pageObj);
  if (!diagram || !diagram.objects) return counts;

  function walk(objects) {
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      const ft = obj.friendlyType || obj.type || 'unknown';
      counts[ft] = (counts[ft] || 0) + 1;
      if (obj.objs) walk(obj.objs);
      if (obj.type === 'dynamicPanel' && obj.diagrams) {
        for (const diag of obj.diagrams) {
          if (diag.objects) walk(diag.objects);
        }
      }
    }
  }

  walk(diagram.objects);
  return counts;
}

// ============================================================================
// HTML Extraction
// ============================================================================

/**
 * Extract text hints from page HTML.
 * Uses simple regex-based parsing (no DOM dependency).
 */
function extractHtmlHints(inputRoot, pageName) {
  const htmlPath = path.join(inputRoot, `${pageName}.html`);
  if (!fs.existsSync(htmlPath)) {
    return { dataLabels: [], visibleTexts: [], placeholders: [], hiddenCount: 0, title: '' };
  }

  try {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Title
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // data-label attributes
    const dataLabels = [];
    const labelRegex = /data-label="([^"]*)"/g;
    let m;
    while ((m = labelRegex.exec(html)) !== null) {
      if (m[1] && !dataLabels.includes(m[1])) {
        dataLabels.push(m[1]);
      }
    }

    // Visible text from <p><span>...</span></p> patterns
    const visibleTexts = [];
    const textRegex = /<p><span>([^<]+)<\/span><\/p>/g;
    while ((m = textRegex.exec(html)) !== null) {
      const text = m[1].trim();
      if (text && text.length > 0 && text.length < 200 && !visibleTexts.includes(text)) {
        visibleTexts.push(text);
      }
    }

    // Input placeholders
    const placeholders = [];
    const phRegex = /placeholder="([^"]*)"/g;
    while ((m = phRegex.exec(html)) !== null) {
      if (m[1] && !placeholders.includes(m[1])) {
        placeholders.push(m[1]);
      }
    }

    // Also check for Axure-style placeholder in data.js objects
    // (This is handled in the page extraction phase)

    // Hidden nodes count
    const hiddenMatches = html.match(/ax_default_hidden/g);
    const hiddenCount = hiddenMatches ? hiddenMatches.length : 0;

    return { dataLabels, visibleTexts, placeholders, hiddenCount, title };
  } catch (e) {
    return { dataLabels: [], visibleTexts: [], placeholders: [], hiddenCount: 0, title: '', error: e.message };
  }
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Generate axure_sitemap.md content.
 */
function generateSitemapMd(sitemap) {
  let md = '# Axure Sitemap\n\n';

  for (const entry of sitemap) {
    const indent = '  '.repeat(entry.depth);
    if (entry.type === 'Folder') {
      md += `${indent}- ${entry.pageName}\n`;
    } else {
      md += `${indent}- ${entry.pageName} -> ${entry.url}\n`;
    }
  }

  return md;
}

/**
 * Generate per-page Markdown content.
 */
function generatePageMd(pageData) {
  const { pageName, url, generationDate, stats, components, dynamicPanels, repeaters, tables, interactions, htmlTextHints, warnings } = pageData;

  let md = `# Page: ${pageName}\n\n`;

  // Basic Info
  md += `## Basic Info\n\n`;
  md += `- **URL**: ${url || 'N/A'}\n`;
  md += `- **Generation Date**: ${generationDate || 'N/A'}\n`;
  md += `- **Object Count**: ${stats.objectCount}\n`;
  md += `- **Interaction Count**: ${stats.interactionCount}\n`;
  md += `- **Component Count**: ${stats.componentCount}\n`;
  md += `- **Dynamic Panel Count**: ${stats.dynamicPanelCount}\n`;
  md += `- **Repeater Count**: ${stats.repeaterCount}\n`;
  md += `- **Table Count**: ${stats.tableCount}\n\n`;

  // Component Type Statistics
  md += `## Component Type Statistics\n\n`;
  const typeCounts = {};
  for (const c of components) {
    const ft = c.friendlyType || c.type || 'unknown';
    typeCounts[ft] = (typeCounts[ft] || 0) + 1;
  }
  if (Object.keys(typeCounts).length > 0) {
    md += '| Type | Count |\n|------|-------|\n';
    for (const [type, count] of Object.entries(typeCounts)) {
      md += `| ${type} | ${count} |\n`;
    }
  } else {
    md += '_No components found_\n';
  }
  md += '\n';

  // Main Components (limit to first 30)
  md += `## Main Components\n\n`;
  const displayComponents = components.slice(0, 30);
  if (displayComponents.length > 0) {
    md += '| ID | Label | Type | Visible | Placeholder |\n|----|-------|------|---------|-------------|\n';
    for (const c of displayComponents) {
      const idShort = c.id.substring(0, 8) + '...';
      md += `| ${idShort} | ${c.label || '-'} | ${c.friendlyType || c.type || '-'} | ${c.visible ? 'Yes' : 'No'} | ${c.placeholderText || '-'} |\n`;
    }
    if (components.length > 30) {
      md += `\n_Showing 30 of ${components.length} components_\n`;
    }
  } else {
    md += '_No components found_\n';
  }
  md += '\n';

  // Dynamic Panels
  md += `## Dynamic Panels\n\n`;
  if (dynamicPanels.length > 0) {
    md += '| ID | Label | States |\n|----|-------|--------|\n';
    for (const dp of dynamicPanels) {
      const idShort = dp.id.substring(0, 8) + '...';
      md += `| ${idShort} | ${dp.label || '-'} | ${dp.stateLabels.join(', ')} (${dp.stateCount}) |\n`;
    }
  } else {
    md += '_No dynamic panels found_\n';
  }
  md += '\n';

  // Repeaters
  md += `## Repeaters\n\n`;
  if (repeaters.length > 0) {
    md += '| ID | Label | Rows | Columns |\n|----|-------|------|----------|\n';
    for (const r of repeaters) {
      const idShort = r.id.substring(0, 8) + '...';
      md += `| ${idShort} | ${r.label || '-'} | ${r.rowCount} | ${r.columnNames.join(', ') || '-'} |\n`;
    }
  } else {
    md += '_No repeaters found_\n';
  }
  md += '\n';

  // Tables
  md += `## Tables\n\n`;
  if (tables && tables.length > 0) {
    md += '| ID | Label | Rows | Columns | Column Labels |\n|----|-------|------|----------|---------------|\n';
    for (const t of tables) {
      const idShort = t.id.substring(0, 8) + '...';
      md += `| ${idShort} | ${t.label || '-'} | ${t.rowCount} | ${t.columnCount} | ${t.columnLabels.join(', ') || '-'} |\n`;
    }
  } else {
    md += '_No tables found_\n';
  }
  md += '\n';

  // Interaction Rules
  md += `## Interaction Rules\n\n`;
  if (interactions.length > 0) {
    md += '| Source | Event Type | Condition | Action | Target | Description |\n|--------|------------|-----------|--------|--------|-------------|\n';
    for (const i of interactions.slice(0, 50)) {
      md += `| ${i.sourceLabel || i.sourceId.substring(0, 8)} | ${i.eventType || i.event} | ${i.conditionString || '-'} | ${i.action || i.displayName || '-'} | ${i.target || '-'} | ${i.description || '-'} |\n`;
    }
    if (interactions.length > 50) {
      md += `\n_Showing 50 of ${interactions.length} interactions_\n`;
    }
  } else {
    md += '_No interactions found_\n';
  }
  md += '\n';

  // HTML Visible Text Hints
  md += `## HTML Visible Text Hints\n\n`;
  if (htmlTextHints && htmlTextHints.length > 0) {
    for (const hint of htmlTextHints) {
      if (hint.type === 'dataLabel') {
        md += `- **data-label**: ${hint.value}\n`;
      } else if (hint.type === 'visibleText') {
        md += `- **Visible text**: ${hint.value}\n`;
      } else if (hint.type === 'placeholder') {
        md += `- **Placeholder**: ${hint.value}\n`;
      } else if (hint.type === 'hiddenCount') {
        md += `- **Hidden nodes**: ${hint.value}\n`;
      }
    }
  } else {
    md += '_No HTML text hints found_\n';
  }
  md += '\n';

  // Parse Warnings
  md += `## Parse Warnings\n\n`;
  if (warnings && warnings.length > 0) {
    for (const w of warnings) {
      md += `- ${w}\n`;
    }
  } else {
    md += '_No warnings_\n';
  }

  return md;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);
  const inputRoot = path.resolve(args.input);
  const outputRoot = path.resolve(args.output);

  console.log('=== Axure RP HTML Ingest ===');
  console.log(`Input:  ${inputRoot}`);
  console.log(`Output: ${outputRoot}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log('');

  // Validate input
  const docJsPath = path.join(inputRoot, 'data', 'document.js');
  if (!fs.existsSync(docJsPath)) {
    console.error(`FATAL: Missing required file: ${docJsPath}`);
    console.error('The input directory must contain data/document.js from an Axure RP HTML export.');
    process.exit(1);
  }

  const filesDir = path.join(inputRoot, 'files');
  if (!fs.existsSync(filesDir)) {
    console.warn(`WARNING: Missing files/ directory. Only sitemap will be extracted.`);
  }

  // Load document.js
  console.log('Loading document.js...');
  const docResult = loadDocumentJs(inputRoot);
  if (docResult.error) {
    console.error(`FATAL: ${docResult.error}`);
    process.exit(1);
  }

  const documentData = extractDocument(docResult.data);
  console.log(`Sitemap: ${documentData.sitemap.length} entries`);

  // Determine which pages to process
  let pageEntries = documentData.sitemap.filter(e => e.type === 'Wireframe');
  
  if (args.pages) {
    pageEntries = pageEntries.filter(e => args.pages.includes(e.pageName));
  }
  if (args.maxPages < pageEntries.length) {
    pageEntries = pageEntries.slice(0, args.maxPages);
  }

  console.log(`Pages to process: ${pageEntries.length}`);

  // Process each page
  const pages = [];
  const errors = [];

  for (const entry of pageEntries) {
    console.log(`\nProcessing page: ${entry.pageName}`);

    const pageResult = loadPageDataJs(inputRoot, entry.pageName);
    const warnings = [];

    if (pageResult.error) {
      console.warn(`  SKIP: ${pageResult.error}`);
      errors.push({ pageName: entry.pageName, error: pageResult.error });
      pages.push({
        pageName: entry.pageName,
        url: entry.url,
        dataJsPath: path.join('files', entry.pageName, 'data.js'),
        htmlPath: `${entry.pageName}.html`,
        stats: { objectCount: 0, interactionCount: 0, componentCount: 0, dynamicPanelCount: 0, repeaterCount: 0, tableCount: 0 },
        components: [],
        dynamicPanels: [],
        repeaters: [],
        tables: [],
        interactions: [],
        htmlTextHints: [],
        warnings: [pageResult.error],
      });
      continue;
    }

    const pageObj = pageResult.data;

    // Extract page info
    const pageName = pageObj.page ? pageObj.page.name || entry.pageName : entry.pageName;
    const pageUrl = pageObj.page ? pageObj.page.url || entry.url : entry.url;
    const generationDate = pageObj.page && pageObj.page.generationDate 
      ? new Date(pageObj.page.generationDate).toISOString() 
      : '';

    // Extract components
    const components = extractComponents(pageObj);
    console.log(`  Components: ${components.length}`);

    // Extract dynamic panels
    const dynamicPanels = extractDynamicPanels(pageObj);
    console.log(`  Dynamic panels: ${dynamicPanels.length}`);

    // Extract repeaters
    const repeaters = extractRepeaters(pageObj);
    console.log(`  Repeaters: ${repeaters.length}`);

    // Extract tables
    const tables = extractTables(pageObj);
    console.log(`  Tables: ${tables.length}`);

    // Extract interactions
    const interactions = extractInteractions(pageObj);
    console.log(`  Interactions: ${interactions.length}`);

    // Extract HTML hints
    const htmlHints = extractHtmlHints(inputRoot, entry.pageName);
    const htmlTextHints = [];
    for (const dl of htmlHints.dataLabels) {
      htmlTextHints.push({ type: 'dataLabel', value: dl });
    }
    for (const vt of htmlHints.visibleTexts) {
      htmlTextHints.push({ type: 'visibleText', value: vt });
    }
    for (const ph of htmlHints.placeholders) {
      htmlTextHints.push({ type: 'placeholder', value: ph });
    }
    if (htmlHints.hiddenCount > 0) {
      htmlTextHints.push({ type: 'hiddenCount', value: htmlHints.hiddenCount });
    }

    // Also extract placeholderText from components
    for (const c of components) {
      if (c.placeholderText && !htmlTextHints.some(h => h.type === 'placeholder' && h.value === c.placeholderText)) {
        htmlTextHints.push({ type: 'placeholder', value: c.placeholderText });
      }
    }

    // Count total objects
    const typeCounts = countObjectTypes(pageObj);
    const objectCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);

    const pageData = {
      pageName,
      url: pageUrl,
      dataJsPath: path.join('files', entry.pageName, 'data.js'),
      htmlPath: `${entry.pageName}.html`,
      stats: {
        objectCount,
        interactionCount: interactions.length,
        componentCount: components.length,
        dynamicPanelCount: dynamicPanels.length,
        repeaterCount: repeaters.length,
        tableCount: tables.length,
      },
      components,
      dynamicPanels,
      repeaters,
      tables,
      interactions,
      htmlTextHints,
      warnings,
      generationDate,
      typeCounts,
    };

    pages.push(pageData);
  }

  // Build final context
  const context = {
    sourceRoot: inputRoot,
    generatedAt: new Date().toISOString(),
    document: documentData,
    pages: pages.map(p => ({
      pageName: p.pageName,
      url: p.url,
      dataJsPath: p.dataJsPath,
      htmlPath: p.htmlPath,
      stats: p.stats,
      components: p.components,
      dynamicPanels: p.dynamicPanels,
      repeaters: p.repeaters,
      tables: p.tables,
      interactions: p.interactions,
      htmlTextHints: p.htmlTextHints,
    })),
    errors,
  };

  // Dry run mode
  if (args.dryRun) {
    console.log('\n=== DRY RUN - No files written ===\n');
    console.log(`Sitemap entries: ${documentData.sitemap.length}`);
    console.log(`Pages processed: ${pages.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log('\nPage summary:');
    for (const p of pages) {
      console.log(`  ${p.pageName}: ${p.stats.componentCount} components, ${p.stats.interactionCount} interactions, ${p.stats.dynamicPanelCount} dynamicPanels, ${p.stats.repeaterCount} repeaters, ${p.stats.tableCount} tables`);
    }
    console.log('\nSitemap:');
    for (const entry of documentData.sitemap) {
      const indent = '  '.repeat(entry.depth);
      console.log(`${indent}${entry.type === 'Folder' ? '📁' : '📄'} ${entry.pageName} ${entry.url ? '-> ' + entry.url : ''}`);
    }
    return;
  }

  // Create output directories
  const pagesDir = path.join(outputRoot, 'pages');
  const logsDir = path.join(outputRoot, 'logs', 'runs');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  // Write axure_context.json
  const contextPath = path.join(outputRoot, 'axure_context.json');
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf-8');
  console.log(`\nWritten: ${contextPath}`);

  // Write axure_sitemap.md
  const sitemapMd = generateSitemapMd(documentData.sitemap);
  const sitemapPath = path.join(outputRoot, 'axure_sitemap.md');
  fs.writeFileSync(sitemapPath, sitemapMd, 'utf-8');
  console.log(`Written: ${sitemapPath}`);

  // Write per-page files
  for (const p of pages) {
    // Sanitize page name for filename (replace problematic chars)
    const safeName = p.pageName.replace(/[<>:"/\\|?*]/g, '_');

    // Per-page JSON
    const pageJsonPath = path.join(pagesDir, `${safeName}.json`);
    fs.writeFileSync(pageJsonPath, JSON.stringify(p, null, 2), 'utf-8');

    // Per-page Markdown
    const pageMd = generatePageMd(p);
    const pageMdPath = path.join(pagesDir, `${safeName}.md`);
    fs.writeFileSync(pageMdPath, pageMd, 'utf-8');

    console.log(`Written: ${pageJsonPath}`);
    console.log(`Written: ${pageMdPath}`);
  }

  // Write run log
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runLog = {
    timestamp: new Date().toISOString(),
    inputRoot,
    outputRoot,
    args: { maxPages: args.maxPages, pages: args.pages, dryRun: args.dryRun },
    stats: {
      sitemapEntries: documentData.sitemap.length,
      pagesProcessed: pages.length,
      errors: errors.length,
    },
    errors,
  };
  const logPath = path.join(logsDir, `axure_ingest_${timestamp}.json`);
  fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf-8');
  console.log(`Written: ${logPath}`);

  console.log('\n=== Ingest Complete ===');
  console.log(`Sitemap entries: ${documentData.sitemap.length}`);
  console.log(`Pages processed: ${pages.length}`);
  console.log(`Errors: ${errors.length}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
