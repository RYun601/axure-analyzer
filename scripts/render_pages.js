#!/usr/bin/env node
/**
 * render_pages.js
 *
 * Render Axure RP HTML export pages in a real browser and extract:
 * - visible text nodes with bounding boxes (breadcrumbs, titles, filters, table headers)
 * - Axure text containers with structured blocks (paragraphs / nested list items)
 * - sticky annotation blocks ("需求说明") including their full text
 * - viewport / artboard geometry
 *
 * Usage:
 *   node render_pages.js --input <export-root> --output <output-root> [options]
 *
 * Options:
 *   --pages a,b          Page names without .html (default: all root HTML pages)
 *   --viewport 1920x1080 Viewport used for rendering (default: 1920x1080)
 *   --chrome <path>      Chrome/Edge executable (or AXURE_CHROME_PATH)
 *   --timeout 30000      Navigation / render timeout in ms
 *   --no-screenshot      Skip PNG screenshots
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

function parseArgs(argv) {
  const args = {
    input: null,
    output: 'analysis',
    pages: null,
    viewport: '1920x1080',
    chrome: process.env.AXURE_CHROME_PATH || '',
    timeout: 30000,
    screenshot: true,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--pages': args.pages = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--viewport': args.viewport = argv[++i]; break;
      case '--chrome': args.chrome = argv[++i]; break;
      case '--timeout': args.timeout = parseInt(argv[++i], 10); break;
      case '--no-screenshot': args.screenshot = false; break;
      default: console.warn(`Unknown argument: ${argv[i]}`);
    }
  }

  if (!args.input) {
    console.error('ERROR: --input is required');
    process.exit(1);
  }
  return args;
}

function parseViewport(value) {
  const m = String(value).match(/^(\d+)x(\d+)$/i);
  if (!m) throw new Error(`Invalid viewport: ${value}. Expected WIDTHxHEIGHT, e.g. 1920x1080`);
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function findChrome(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find(p => fs.existsSync(p)) || '';
}

function listPages(inputRoot) {
  return fs.readdirSync(inputRoot, { withFileTypes: true })
    .filter(d => d.isFile() && /\.html$/i.test(d.name))
    .map(d => d.name.replace(/\.html$/i, ''))
    .filter(name => name.toLowerCase() !== 'index')
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Browser-side extraction. Must stay self-contained.
 */
function extractPage(arg) {
  const viewportWidth = arg.viewportWidth;
  const viewportHeight = arg.viewportHeight;
  const base = document.getElementById('base') || document.body;
  const baseRect = base.getBoundingClientRect();

  const norm = (s) => (s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const normInline = (s) => norm(s).replace(/\n+/g, ' ').trim();

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      right: Math.round(r.right * 100) / 100,
      bottom: Math.round(r.bottom * 100) / 100,
    };
  };

  const pageHeight = Math.max(
    document.documentElement ? document.documentElement.scrollHeight : 0,
    document.body ? document.body.scrollHeight : 0,
    viewportHeight
  );

  const isOffCanvas = (r) => (
    r.right <= 0 || r.bottom <= 0 ||
    r.x >= viewportWidth || r.y >= pageHeight
  );

  // Detect a desktop sidebar: a full-height block anchored at the left edge.
  // This keeps menu labels (e.g. the sidebar "首页") out of breadcrumb grouping.
  const sidebarCandidates = [];
  Array.from(base.querySelectorAll('div[id]')).forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.x <= 2 && r.width >= 180 && r.width <= 320 && r.height >= viewportHeight * 0.7) {
      sidebarCandidates.push({ el, r, area: r.width * r.height });
    }
  });
  sidebarCandidates.sort((a, b) => b.area - a.area);
  const sidebarEl = sidebarCandidates.length ? sidebarCandidates[0] : null;
  const sidebarRect = sidebarEl ? {
    x: Math.round(sidebarEl.r.x * 100) / 100,
    y: Math.round(sidebarEl.r.y * 100) / 100,
    w: Math.round(sidebarEl.r.width * 100) / 100,
    h: Math.round(sidebarEl.r.height * 100) / 100,
    right: Math.round(sidebarEl.r.right * 100) / 100,
    bottom: Math.round(sidebarEl.r.bottom * 100) / 100,
  } : null;

  const isInSidebar = (r) => {
    if (!sidebarRect) return false;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return cx >= sidebarRect.x && cx <= sidebarRect.right && cy >= sidebarRect.y && cy <= sidebarRect.bottom;
  };

  // Detect the main content card (large block, but not the full-page background or sidebar).
  const contentCandidates = [];
  Array.from(base.querySelectorAll('div[id]')).forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    const isFullPage = r.width >= viewportWidth * 0.98 && r.height >= viewportHeight * 0.98;
    const isSidebarWidth = r.width <= 320;
    if (isFullPage || isSidebarWidth) return;
    if (r.width >= viewportWidth * 0.5 && r.height >= viewportHeight * 0.2) {
      contentCandidates.push({ el, r, area: r.width * r.height });
    }
  });
  contentCandidates.sort((a, b) => b.area - a.area);
  const contentEl = contentCandidates.length ? contentCandidates[0] : null;
  let contentRect = contentEl ? {
    x: Math.round(contentEl.r.x * 100) / 100,
    y: Math.round(contentEl.r.y * 100) / 100,
    w: Math.round(contentEl.r.width * 100) / 100,
    h: Math.round(contentEl.r.height * 100) / 100,
    right: Math.round(contentEl.r.right * 100) / 100,
    bottom: Math.round(contentEl.r.bottom * 100) / 100,
  } : null;

  const nearestId = (el) => {
    let p = el;
    while (p && p !== base) {
      if (p.id && !/_text$/.test(p.id)) return p.id;
      p = p.parentElement;
    }
    return null;
  };

  // Large images are common in image-based Axure prototypes (the whole UI is one PNG).
  const images = [];
  Array.from(base.querySelectorAll('img')).forEach((el) => {
    if (!isVisible(el)) return;
    const r = rectOf(el);
    if (r.w <= 0 || r.h <= 0) return;
    images.push({
      id: el.id || null,
      src: el.getAttribute('src') || '',
      bbox: r,
      area: r.w * r.h,
    });
  });
  images.sort((a, b) => b.area - a.area);
  const backgroundImage = images[0] || null;

  const blocksFromTextContainer = (el) => {
    const blocks = [];

    const walkList = (list, level) => {
      for (const li of Array.from(list.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        let direct = '';
        for (const node of Array.from(li.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE) {
            direct += node.nodeValue || '';
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (tag !== 'ul' && tag !== 'ol') direct += node.textContent || '';
          }
        }
        const text = normInline(direct);
        if (text) blocks.push({ type: 'listItem', text, level });
        for (const child of Array.from(li.children)) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'ul' || tag === 'ol') walkList(child, level + 1);
        }
      }
    };

    const walk = (node, level) => {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'p') {
          const text = normInline(child.innerText || child.textContent || '');
          if (text) blocks.push({ type: 'paragraph', text, level });
        } else if (tag === 'ul' || tag === 'ol') {
          walkList(child, level + 1);
        } else if (child.querySelector('p, ul, ol')) {
          walk(child, level);
        } else {
          const text = normInline(child.innerText || child.textContent || '');
          if (text) blocks.push({ type: 'paragraph', text, level });
        }
      }
    };

    walk(el, 0);
    return blocks;
  };

  // 1) Axure text containers: <div id="u123_text" class="text">...
  const textContainers = [];
  const annotationEls = [];
  Array.from(document.querySelectorAll('#base [id$="_text"], body > [id$="_text"]')).forEach((el) => {
    if (!isVisible(el)) return;
    const text = norm(el.innerText || el.textContent || '');
    if (!text) return;

    const parent = el.parentElement;
    if (!parent) return;
    const r = rectOf(parent);
    const style = window.getComputedStyle(el);
    const parentStyle = window.getComputedStyle(parent);
    const className = String(parent.className || '');
    const isAnnotation = /sticky/i.test(className) || /^需求说明/.test(text);
    if (isAnnotation) annotationEls.push(parent);

    textContainers.push({
      id: parent.id || null,
      textId: el.id || null,
      className,
      text,
      blocks: blocksFromTextContainer(el),
      bbox: r,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      background: parentStyle.backgroundColor,
      borderColor: parentStyle.borderColor,
      isAnnotation,
      inSidebar: isInSidebar(r),
      offCanvas: isOffCanvas(r),
    });
  });

  // Fallback for pages without a large content card (e.g. H5 screens):
  // derive the content bounds from visible non-annotation text containers.
  if (!contentRect) {
    const inside = textContainers.filter(c => !c.isAnnotation && !c.offCanvas && !c.inSidebar);
    if (inside.length) {
      const left = Math.min(...inside.map(c => c.bbox.x));
      const top = Math.min(...inside.map(c => c.bbox.y));
      const right = Math.max(...inside.map(c => c.bbox.right));
      const bottom = Math.max(...inside.map(c => c.bbox.bottom));
      contentRect = {
        x: Math.round(left * 100) / 100,
        y: Math.round(top * 100) / 100,
        w: Math.round((right - left) * 100) / 100,
        h: Math.round((bottom - top) * 100) / 100,
        right: Math.round(right * 100) / 100,
        bottom: Math.round(bottom * 100) / 100,
      };
    }
  }

  // Image-based prototype: a large image covers most of the page and there is
  // very little visible non-annotation DOM text.
  const visibleNonAnnotationContainers = textContainers.filter(c => !c.isAnnotation && !c.offCanvas && !c.inSidebar);
  const imageBased = Boolean(
    backgroundImage &&
    backgroundImage.area > viewportWidth * viewportHeight * 0.5 &&
    visibleNonAnnotationContainers.length <= 3
  );

  // 2) Individual text nodes with precise bounding boxes (used for breadcrumb grouping)
  const textNodes = [];
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = normInline(node.nodeValue || '');
    if (!text) continue;
    const el = node.parentElement;
    if (!el || !isVisible(el)) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rr = range.getBoundingClientRect();
    if (rr.width <= 0 || rr.height <= 0) continue;

    const style = window.getComputedStyle(el);
    const r = {
      x: Math.round(rr.x * 100) / 100,
      y: Math.round(rr.y * 100) / 100,
      w: Math.round(rr.width * 100) / 100,
      h: Math.round(rr.height * 100) / 100,
      right: Math.round(rr.right * 100) / 100,
      bottom: Math.round(rr.bottom * 100) / 100,
    };

    textNodes.push({
      text,
      bbox: r,
      parentId: nearestId(el),
      parentClass: String(el.className || ''),
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      inSidebar: isInSidebar(r),
      inAnnotation: annotationEls.some(a => a.contains(el)),
      offCanvas: isOffCanvas(r),
    });
  }

  // 3) Group text nodes into lines and vertical bands.
  const visibleNodes = textNodes.filter(n => !n.offCanvas && !n.inSidebar && !n.inAnnotation);
  const lines = [];

  for (const item of visibleNodes.slice().sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    const centerY = item.bbox.y + item.bbox.h / 2;
    let line = lines.find(l => Math.abs(l.centerY - centerY) <= 6);
    if (!line) {
      line = { centerY, items: [], bbox: { ...item.bbox } };
      lines.push(line);
    }
    line.items.push(item);
    line.bbox.x = Math.min(line.bbox.x, item.bbox.x);
    line.bbox.y = Math.min(line.bbox.y, item.bbox.y);
    line.bbox.right = Math.max(line.bbox.right, item.bbox.right);
    line.bbox.bottom = Math.max(line.bbox.bottom, item.bbox.bottom);
    line.bbox.w = Math.round((line.bbox.right - line.bbox.x) * 100) / 100;
    line.bbox.h = Math.round((line.bbox.bottom - line.bbox.y) * 100) / 100;
  }

  lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  for (const line of lines) {
    line.items.sort((a, b) => a.bbox.x - b.bbox.x);
    line.text = line.items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
  }

  const bands = [];
  for (const line of lines) {
    let band = bands[bands.length - 1];
    if (!band || line.bbox.y - band.bbox.bottom > 12) {
      band = { lines: [], bbox: { ...line.bbox } };
      bands.push(band);
    }
    band.lines.push(line);
    band.bbox.x = Math.min(band.bbox.x, line.bbox.x);
    band.bbox.y = Math.min(band.bbox.y, line.bbox.y);
    band.bbox.right = Math.max(band.bbox.right, line.bbox.right);
    band.bbox.bottom = Math.max(band.bbox.bottom, line.bbox.bottom);
    band.bbox.w = Math.round((band.bbox.right - band.bbox.x) * 100) / 100;
    band.bbox.h = Math.round((band.bbox.bottom - band.bbox.y) * 100) / 100;
  }

  // 4) Breadcrumb heuristic: the topmost text band between the top bar and the content card.
  // Do not search inside the content card: KPI labels such as "讲者人数 / 人次" are not breadcrumbs.
  const contentTop = contentRect ? Math.max(contentRect.y, 120) : 150;
  const crumbBands = bands
    .filter(b => b.bbox.y >= 60 && b.bbox.y < contentTop)
    .sort((a, b) => a.bbox.y - b.bbox.y);
  const crumbBand = crumbBands[0] || null;

  let breadcrumb = null;
  if (sidebarRect && crumbBand) {
    const items = crumbBand.lines.flatMap(l => l.items).sort((a, b) => a.bbox.x - b.bbox.x);
    const text = items.map(i => i.text).join(' ').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
    const hasSlash = text.includes('/');
    breadcrumb = {
      text,
      items: items.map(i => ({
        text: i.text,
        parentId: i.parentId,
        bbox: i.bbox,
      })),
      bbox: crumbBand.bbox,
      confidence: (hasSlash && items.length >= 2) ? 'high' : (items.length >= 1 ? 'medium' : 'low'),
    };
  }

  // 5) Annotation blocks: sticky notes and blocks whose text starts with 需求说明.
  const annotationMap = new Map();
  for (const c of textContainers.filter(c => c.isAnnotation)) {
    const key = c.id || c.text.slice(0, 80);
    const existing = annotationMap.get(key);
    if (!existing || (c.blocks && c.blocks.length > (existing.blocks || []).length)) {
      annotationMap.set(key, c);
    }
  }

  const annotations = Array.from(annotationMap.values())
    .map(c => ({
      id: c.id,
      kind: /sticky/i.test(c.className) ? 'sticky' : 'annotation',
      className: c.className,
      title: (c.blocks[0] && c.blocks[0].text) || c.text.split('\n')[0],
      text: c.text,
      blocks: c.blocks,
      bbox: c.bbox,
      offCanvas: c.offCanvas,
      background: c.background,
      color: c.color,
      fontSize: c.fontSize,
    }))
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

  return {
    pageTitle: document.title || '',
    viewport: { width: viewportWidth, height: viewportHeight },
    base: {
      x: Math.round(baseRect.x * 100) / 100,
      y: Math.round(baseRect.y * 100) / 100,
      w: Math.round(baseRect.width * 100) / 100,
      h: Math.round(baseRect.height * 100) / 100,
    },
    sidebar: sidebarRect,
    content: contentRect,
    imageBased,
    backgroundImage,
    images: images.slice(0, 5),
    breadcrumb,
    bands: bands.map((b, index) => ({
      index: index + 1,
      bbox: b.bbox,
      text: b.lines.map(l => l.text).join(' / ').replace(/\s+/g, ' ').trim(),
      lines: b.lines.map(l => ({
        text: l.text,
        bbox: l.bbox,
        items: l.items.map(i => ({ text: i.text, parentId: i.parentId, bbox: i.bbox })),
      })),
    })),
    textContainers: textContainers.map(c => ({
      id: c.id,
      textId: c.textId,
      className: c.className,
      text: c.text,
      blocks: c.blocks,
      bbox: c.bbox,
      color: c.color,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      background: c.background,
      isAnnotation: c.isAnnotation,
      inSidebar: c.inSidebar,
      offCanvas: c.offCanvas,
    })),
    textNodes,
    annotations,
    stats: {
      textContainers: textContainers.length,
      textNodes: textNodes.length,
      visibleTextNodes: visibleNodes.length,
      lines: lines.length,
      bands: bands.length,
      annotations: annotations.length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const inputRoot = path.resolve(args.input);
  const outputRoot = path.resolve(args.output);
  const viewport = parseViewport(args.viewport);

  if (!fs.existsSync(inputRoot)) {
    throw new Error(`Input directory does not exist: ${inputRoot}`);
  }

  const pages = args.pages && args.pages.length ? args.pages : listPages(inputRoot);
  const renderedDir = path.join(outputRoot, 'rendered');
  const screenshotDir = path.join(outputRoot, 'screenshots');
  fs.mkdirSync(renderedDir, { recursive: true });
  if (args.screenshot) fs.mkdirSync(screenshotDir, { recursive: true });

  const chromePath = findChrome(args.chrome);
  if (!chromePath) {
    throw new Error('Chrome/Edge not found. Set AXURE_CHROME_PATH or pass --chrome <path>.');
  }

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--allow-file-access-from-files'],
  });

  const results = [];
  try {
    for (const pageName of pages) {
      const htmlPath = path.join(inputRoot, `${pageName}.html`);
      if (!fs.existsSync(htmlPath)) {
        results.push({ page: pageName, status: 'missing', error: htmlPath });
        console.error(`[missing] ${htmlPath}`);
        continue;
      }

      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      try {
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: args.timeout });
        await page.waitForFunction(() => !!document.getElementById('base'), null, { timeout: args.timeout });
        await page.waitForTimeout(800);

        const data = await page.evaluate(extractPage, {
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        });

        const renderedPath = path.join(renderedDir, `${safeFileName(pageName)}.json`);
        fs.writeFileSync(renderedPath, JSON.stringify({ page: pageName, source: htmlPath, ...data }, null, 2), 'utf-8');

        let screenshotPath = null;
        if (args.screenshot) {
          screenshotPath = path.join(screenshotDir, `${safeFileName(pageName)}.png`);
          // Axure's #base can be reported as "not visible" while children are rendered
          // (the player may hide/reparent it during startup). A viewport screenshot is
          // deterministic and keeps off-canvas sticky notes out of the image.
          await page.screenshot({ path: screenshotPath, fullPage: false });
        }

        results.push({
          page: pageName,
          status: 'ok',
          rendered: renderedPath,
          screenshot: screenshotPath,
          breadcrumb: data.breadcrumb ? data.breadcrumb.text : null,
          annotations: data.annotations.length,
          stats: data.stats,
        });
        console.log(`[ok] ${pageName} | breadcrumb: ${data.breadcrumb ? data.breadcrumb.text : '(not found)'} | annotations: ${data.annotations.length}`);
      } catch (err) {
        results.push({ page: pageName, status: 'error', error: err.message });
        console.error(`[error] ${pageName}: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const summaryPath = path.join(outputRoot, 'render-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: inputRoot,
    viewport,
    chrome: chromePath,
    results,
  }, null, 2), 'utf-8');

  const ok = results.filter(r => r.status === 'ok').length;
  console.log(`\nRendered ${ok}/${results.length} page(s). Summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
