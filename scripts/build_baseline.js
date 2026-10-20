#!/usr/bin/env node
/**
 * build_baseline.js
 *
 * Combine the existing Axure structure extractor with the rendered UI data
 * into per-page baseline files:
 *   baseline/<page>.json  - machine-readable
 *   baseline/<page>.md    - human/LLM-readable
 *
 * Usage:
 *   node build_baseline.js --input <export-root> --output <output-root> [--pages a,b]
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    input: null,
    output: 'analysis',
    pages: null,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--pages': args.pages = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      default: console.warn(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!args.input) {
    console.error('ERROR: --input is required');
    process.exit(1);
  }
  return args;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`Cannot parse JSON: ${file}: ${err.message}`);
    return null;
  }
}

function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

function mdEscape(text) {
  return String(text || '').replace(/\|/g, '\\|');
}

function formatAnnotationBlocks(blocks) {
  if (!blocks || !blocks.length) return '';
  const lines = [];
  for (const block of blocks) {
    const level = Math.max(0, Number(block.level) || 0);
    const indent = '  '.repeat(Math.max(0, level - 1));
    if (block.type === 'listItem') {
      lines.push(`${indent}- ${block.text}`);
    } else if (block.type === 'orderedItem') {
      lines.push(`${indent}1. ${block.text}`);
    } else {
      lines.push(`${indent}${block.text}`);
    }
  }
  return lines.join('\n');
}

function annotationSummary(annotation) {
  const blocks = annotation.blocks || [];
  const first = blocks[0];
  if (first && first.text && !/^需求说明/.test(first.text)) return first.text;
  const numbered = blocks.find(b => /^\d+[、.)]/.test(b.text || ''));
  return (numbered || blocks[1] || blocks[0] || { text: annotation.text || '' }).text;
}

function formatBands(bands) {
  if (!bands || !bands.length) return '_未识别到文本区域_';
  const lines = ['| # | y 范围 | 文本 |', '| --- | --- | --- |'];
  for (const band of bands) {
    const y = `${Math.round(band.bbox.y)}–${Math.round(band.bbox.bottom)}`;
    lines.push(`| ${band.index} | ${y} | ${mdEscape(band.text)} |`);
  }
  return lines.join('\n');
}

function formatBreadcrumb(rendered) {
  const crumb = rendered.breadcrumb;
  if (!crumb) {
    if (rendered.imageBased) {
      return 'UI 为整张图片，DOM 中无法识别面包屑；请查看截图或 OCR。';
    }
    return [
      '未自动识别面包屑。请查看截图 `screenshots/<page>.png`，并从 `bands` 顶部区域人工确认。',
    ].join('\n');
  }

  const lines = [
    `- **拼接文本**：${crumb.text}`,
    `- **置信度**：${crumb.confidence}`,
    `- **证据**：y=${Math.round(crumb.bbox.y)}，x=${Math.round(crumb.bbox.x)}…${Math.round(crumb.bbox.right)}`,
    '',
    '| 顺序 | 文本 | Axure ID | x | y |',
    '| --- | --- | --- | --- | --- |',
  ];
  crumb.items.forEach((item, index) => {
    lines.push(`| ${index + 1} | ${mdEscape(item.text)} | ${item.parentId || '-'} | ${Math.round(item.bbox.x)} | ${Math.round(item.bbox.y)} |`);
  });
  return lines.join('\n');
}

function formatAnnotations(annotations) {
  if (!annotations || !annotations.length) {
    return '_未发现 sticky 注释块或“需求说明”文本。_';
  }

  const lines = [
    '| # | Axure ID | 位置 | 画布外 | 摘要 |',
    '| --- | --- | --- | --- | --- |',
  ];
  annotations.forEach((a, index) => {
    const pos = `x=${Math.round(a.bbox.x)}, y=${Math.round(a.bbox.y)}, ${Math.round(a.bbox.w)}×${Math.round(a.bbox.h)}`;
    lines.push(`| ${index + 1} | ${a.id || '-'} | ${pos} | ${a.offCanvas ? '是' : '否'} | ${mdEscape(annotationSummary(a))} |`);
  });

  annotations.forEach((a, index) => {
    const pos = `x=${Math.round(a.bbox.x)}, y=${Math.round(a.bbox.y)}, ${Math.round(a.bbox.w)}×${Math.round(a.bbox.h)}`;
    lines.push('');
    lines.push(`### ${index + 1}. ${a.id || '未命名注释'} · ${a.offCanvas ? '画布外' : '画布内'} · ${pos}`);
    if (a.offCanvas) {
      lines.push('');
      lines.push('> 该注释块位于画布外，属于原型需求说明，不是实际界面文本。');
    }
    lines.push('');
    const body = formatAnnotationBlocks(a.blocks) || a.text;
    lines.push(body);
  });

  return lines.join('\n');
}

function formatInteractions(pageData) {
  const interactions = (pageData && pageData.interactions) || [];
  if (!interactions.length) return '_data.js 中未提取到交互。_';

  const lines = [
    '| 来源 | 事件 | 条件 | 动作 | 目标 | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const it of interactions) {
    lines.push(`| ${mdEscape(it.sourceLabel || it.sourceId || '-')} | ${mdEscape(it.event || '-')} | ${mdEscape(it.conditionString || '-')} | ${mdEscape(it.action || '-')} | ${mdEscape(it.target || '-')} | ${mdEscape(it.description || '-')} |`);
  }
  return lines.join('\n');
}

function buildMarkdown(pageName, rendered, pageData, ocrText) {
  const stats = rendered.stats || {};
  const content = rendered.content || null;
  const sidebar = rendered.sidebar || null;
  const imageBased = Boolean(rendered.imageBased);
  const backgroundImage = rendered.backgroundImage || null;
  const hasOcr = Boolean(ocrText && ocrText.trim());
  const ocrBody = hasOcr
    ? ocrText.replace(/^# OCR:[\s\S]*?\n---\n\n?/, '').trim() || ocrText.trim()
    : '';
  const contentText = imageBased && backgroundImage
    ? `整图 ${Math.round(backgroundImage.bbox.w)}×${Math.round(backgroundImage.bbox.h)}（x=${Math.round(backgroundImage.bbox.x)}, y=${Math.round(backgroundImage.bbox.y)}）`
    : (content
      ? `x=${Math.round(content.x)}, y=${Math.round(content.y)}, ${Math.round(content.w)}×${Math.round(content.h)}`
      : `按视口 ${rendered.viewport.width}×${rendered.viewport.height} 计算`);
  const imageText = backgroundImage
    ? `\`${backgroundImage.src}\`（${Math.round(backgroundImage.bbox.w)}×${Math.round(backgroundImage.bbox.h)}）`
    : '无';
  const bandsMarkdown = imageBased
    ? ((rendered.bands && rendered.bands.length)
      ? `> UI 为整张图片。以下仅为 DOM 中残留的少量文本，不代表完整界面。\n\n${formatBands(rendered.bands)}`
      : '_UI 为整张图片，DOM 未提供可分组文本；请查看截图或 OCR。_')
    : formatBands(rendered.bands);
  const lines = [
    `# ${pageName}`,
    '',
    '> 由 `axure-analyzer` 自动生成。界面结构来自真实浏览器渲染；需求说明来自 Axure sticky 注释块。',
    '',
    '## 页面信息',
    '',
    `- **页面**：${pageName}`,
    `- **来源**：${rendered.source || ''}`,
    `- **视口**：${rendered.viewport.width}×${rendered.viewport.height}`,
    `- **UI 类型**：${imageBased ? '图片型原型（UI 为整图）' : 'DOM 文本型'}`,
    `- **背景图**：${imageText}`,
    `- **OCR**：${hasOcr ? '已生成 `ocr/<页面>.md`' : (imageBased ? '未生成（可加 `--ocr`）' : '不适用')}`,
    `- **主内容区**：${contentText}`,
    `- **侧栏**：${sidebar ? `x=${Math.round(sidebar.x)}, y=${Math.round(sidebar.y)}, ${Math.round(sidebar.w)}×${Math.round(sidebar.h)}（已从面包屑/分带中排除）` : '未检测到'}`,
    `- **文本容器 / 文本节点 / 行 / 分带 / 注释**：${stats.textContainers || 0} / ${stats.textNodes || 0} / ${stats.lines || 0} / ${stats.bands || 0} / ${stats.annotations || 0}`,
    '',
    '## 面包屑',
    '',
    formatBreadcrumb(rendered),
    '',
    '## 页面区域（按纵向分带）',
    '',
    bandsMarkdown,
    '',
    '## 需求说明（原型注释）',
    '',
    formatAnnotations(rendered.annotations),
    '',
    '## 交互（来自 data.js）',
    '',
    formatInteractions(pageData),
    '',
    '## 使用提示',
    '',
    '- 面包屑与界面结构以本文件的 `面包屑` / `页面区域` 为准；静态 HTML 文本可能漏掉浏览器运行时注入的文字。',
    '- `需求说明` 是业务规则，不是界面文本；实现对照时应逐条引用编号。',
    '- 每条结论都应能追溯到 Axure ID、bbox 或截图。',
    '',
  ];

  if (imageBased) {
    const crumbIndex = lines.indexOf('## 面包屑');
    lines.splice(
      crumbIndex,
      0,
      '> **该页面是图片型原型**：UI 主体是一张整图，DOM 中几乎没有可提取的界面文本。',
      '> 下方“需求说明”仍然完整；界面结构请结合 `screenshots/<页面>.png` 或 OCR 分析，不要根据少量 DOM 文本推断。',
      ''
    );
  }

  if (hasOcr) {
    const notesIndex = lines.indexOf('## 需求说明（原型注释）');
    lines.splice(
      notesIndex,
      0,
      '## UI OCR（图片型原型）',
      '',
      ocrBody,
      ''
    );
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const outputRoot = path.resolve(args.output);
  const renderedDir = path.join(outputRoot, 'rendered');
  const extractedPagesDir = path.join(outputRoot, 'extracted', 'pages');
  const baselineDir = path.join(outputRoot, 'baseline');
  fs.mkdirSync(baselineDir, { recursive: true });

  if (!fs.existsSync(renderedDir)) {
    throw new Error(`Rendered directory not found: ${renderedDir}. Run render_pages.js first.`);
  }

  const pages = args.pages && args.pages.length
    ? args.pages
    : fs.readdirSync(renderedDir)
      .filter(f => f.toLowerCase().endsWith('.json'))
      .map(f => f.replace(/\.json$/i, ''));

  let count = 0;
  for (const pageName of pages) {
    const rendered = readJson(path.join(renderedDir, `${safeFileName(pageName)}.json`));
    if (!rendered) {
      console.warn(`[skip] No rendered data for ${pageName}`);
      continue;
    }
    const pageData = readJson(path.join(extractedPagesDir, `${pageName}.json`));
    const ocrPath = path.join(outputRoot, 'ocr', `${safeFileName(pageName)}.md`);
    const ocrText = fs.existsSync(ocrPath) ? fs.readFileSync(ocrPath, 'utf-8') : '';

    const baseline = {
      page: pageName,
      generatedAt: new Date().toISOString(),
      source: rendered.source,
      viewport: rendered.viewport,
      base: rendered.base,
      content: rendered.content,
      sidebar: rendered.sidebar,
      imageBased: rendered.imageBased,
      backgroundImage: rendered.backgroundImage,
      breadcrumb: rendered.breadcrumb,
      ocr: Boolean(ocrText && ocrText.trim()),
      annotations: rendered.annotations,
      bands: rendered.bands,
      interactions: pageData ? pageData.interactions : [],
      stats: rendered.stats,
    };

    fs.writeFileSync(path.join(baselineDir, `${safeFileName(pageName)}.json`), JSON.stringify(baseline, null, 2), 'utf-8');
    fs.writeFileSync(path.join(baselineDir, `${safeFileName(pageName)}.md`), buildMarkdown(pageName, rendered, pageData, ocrText), 'utf-8');
    count++;
    console.log(`[baseline] ${pageName} -> ${path.join(baselineDir, `${safeFileName(pageName)}.md`)}`);
  }

  console.log(`\nBuilt ${count} baseline file(s) in ${baselineDir}`);
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
}
