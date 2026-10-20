#!/usr/bin/env node
/**
 * ocr_pages.js
 *
 * Run OCR for image-based Axure pages (pages whose UI is a single large image).
 * The OCR command is pluggable so the skill does not hard-code a vendor.
 *
 * Usage:
 *   node ocr_pages.js --input <export-root> --output <analysis-root> [options]
 *
 * Options:
 *   --pages a,b          Page names (default: all rendered pages)
 *   --cmd "<template>"   Command template; placeholders: {image}, {output}
 *                        Default: local RapidOCR via scripts/ocr_image.py
 *                        Or set AXURE_OCR_CMD.
 *   --timeout 180000     Per-page OCR timeout in ms
 *   --dry-run            Print commands without running
 *
 * Examples:
 *   node ocr_pages.js --input "D:/prototype" --output "analysis" --pages "PageName"
 *   node ocr_pages.js --input "D:/prototype" --output "analysis" --cmd "python long_screenshot_ocr.py \"{image}\" -o \"{output}\""
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const ocrScript = path.join(__dirname, 'ocr_image.py');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const defaultCmd = process.env.AXURE_OCR_CMD
    || (fs.existsSync(ocrScript) ? `${python} "${ocrScript}" "{image}"` : 'glance "{image}" --ocr');

  const args = {
    input: null,
    output: 'analysis',
    pages: null,
    cmd: defaultCmd,
    timeout: 180000,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--pages': args.pages = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--cmd': args.cmd = argv[++i]; break;
      case '--timeout': args.timeout = parseInt(argv[++i], 10); break;
      case '--dry-run': args.dryRun = true; break;
      default: console.warn(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!args.input) {
    console.error('ERROR: --input is required');
    process.exit(1);
  }
  return args;
}

function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function resolveImagePath(rendered) {
  const bg = rendered && rendered.backgroundImage;
  if (!bg || !bg.src) return null;
  if (path.isAbsolute(bg.src)) return bg.src;
  const baseDir = rendered.source ? path.dirname(rendered.source) : process.cwd();
  return path.resolve(baseDir, bg.src);
}

function main() {
  const args = parseArgs(process.argv);
  const outputRoot = path.resolve(args.output);
  const renderedDir = path.join(outputRoot, 'rendered');
  const ocrDir = path.join(outputRoot, 'ocr');
  fs.mkdirSync(ocrDir, { recursive: true });

  if (!fs.existsSync(renderedDir)) {
    throw new Error(`Rendered directory not found: ${renderedDir}. Run render_pages.js first.`);
  }

  const pages = args.pages && args.pages.length
    ? args.pages
    : fs.readdirSync(renderedDir)
      .filter(f => f.toLowerCase().endsWith('.json'))
      .map(f => f.replace(/\.json$/i, ''));

  let ran = 0;
  let skipped = 0;
  let failed = 0;

  for (const pageName of pages) {
    const rendered = readJson(path.join(renderedDir, `${safeFileName(pageName)}.json`));
    if (!rendered) {
      console.warn(`[skip] no rendered JSON: ${pageName}`);
      skipped++;
      continue;
    }
    if (!rendered.imageBased) {
      console.log(`[skip] ${pageName}: not image-based`);
      skipped++;
      continue;
    }

    const imagePath = resolveImagePath(rendered);
    if (!imagePath || !fs.existsSync(imagePath)) {
      console.warn(`[skip] ${pageName}: background image not found (${imagePath || 'none'})`);
      skipped++;
      continue;
    }

    const outputPath = path.join(ocrDir, `${safeFileName(pageName)}.md`);
    const command = args.cmd
      .replace(/\{image\}/g, imagePath)
      .replace(/\{output\}/g, outputPath);

    if (args.dryRun) {
      console.log(`[dry-run] ${pageName}: ${command}`);
      continue;
    }

    console.log(`[ocr] ${pageName} -> ${outputPath}`);
    const result = spawnSync(command, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: args.timeout,
    });

    if (result.error) {
      console.error(`[error] ${pageName}: ${result.error.message}`);
      failed++;
      continue;
    }

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const body = stdout.replace(/^- 图片：.*\r?\n/, '').trim();

    if (result.status !== 0) {
      console.error(`[error] ${pageName}: exit ${result.status}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`);
      failed++;
      continue;
    }

    if (!stdout) {
      console.warn(`[warn] ${pageName}: OCR command produced no stdout${stderr ? ` (${stderr.slice(0, 200)})` : ''}`);
      failed++;
      continue;
    }

    const header = [
      `# OCR: ${pageName}`,
      '',
      `- 图片：\`${imagePath}\``,
      `- 命令：\`${command}\``,
      `- 时间：${new Date().toISOString()}`,
      '',
      '> OCR 结果用于补充图片型原型的 UI 文字（表头、字段、按钮等），不是业务需求说明。',
      '',
      '---',
      '',
      '',
    ].join('\n');

    fs.writeFileSync(outputPath, header + body + '\n', 'utf-8');
    ran++;
  }

  console.log(`\nOCR finished: ${ran} run, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0 && ran === 0) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
}
