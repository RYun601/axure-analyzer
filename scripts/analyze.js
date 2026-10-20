#!/usr/bin/env node
/**
 * analyze.js
 *
 * One-command Axure prototype analysis:
 *   1. ingest_axure_html.js  -> sitemap, components, interactions
 *   2. render_pages.js       -> rendered text, breadcrumb, annotations, screenshots
 *   3. build_baseline.js     -> baseline/<page>.md + .json
 *
 * Usage:
 *   node analyze.js --input <export-root> --output <output-root> [--pages a,b] [options]
 */

const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    input: null,
    output: 'analysis',
    pages: null,
    viewport: '1920x1080',
    chrome: '',
    timeout: 30000,
    skipIngest: false,
    skipRender: false,
    skipBaseline: false,
    ocr: false,
    ocrCmd: '',
    ocrTimeout: 120000,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--pages': args.pages = argv[++i]; break;
      case '--viewport': args.viewport = argv[++i]; break;
      case '--chrome': args.chrome = argv[++i]; break;
      case '--timeout': args.timeout = argv[++i]; break;
      case '--skip-ingest': args.skipIngest = true; break;
      case '--skip-render': args.skipRender = true; break;
      case '--skip-baseline': args.skipBaseline = true; break;
      case '--ocr': args.ocr = true; break;
      case '--ocr-cmd': args.ocrCmd = argv[++i]; break;
      case '--ocr-timeout': args.ocrTimeout = parseInt(argv[++i], 10); break;
      default: console.warn(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!args.input) {
    console.error('ERROR: --input is required');
    process.exit(1);
  }
  return args;
}

function run(script, args) {
  console.log(`\n> node ${path.relative(process.cwd(), script)} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    cwd: path.dirname(script),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const input = path.resolve(args.input);
  const output = path.resolve(args.output);
  const scripts = path.resolve(__dirname);

  const pageArgs = args.pages ? ['--pages', args.pages] : [];

  if (!args.skipIngest) {
    run(path.join(scripts, 'axure', 'ingest_axure_html.js'), [
      '--input', input,
      '--output', path.join(output, 'extracted'),
      ...pageArgs,
    ]);
  }

  if (!args.skipRender) {
    run(path.join(scripts, 'render_pages.js'), [
      '--input', input,
      '--output', output,
      '--viewport', args.viewport,
      '--timeout', String(args.timeout),
      ...(args.chrome ? ['--chrome', args.chrome] : []),
      ...pageArgs,
    ]);
  }

  if (args.ocr) {
    run(path.join(scripts, 'ocr_pages.js'), [
      '--input', input,
      '--output', output,
      '--timeout', String(args.ocrTimeout),
      ...(args.ocrCmd ? ['--cmd', args.ocrCmd] : []),
      ...pageArgs,
    ]);
  }

  if (!args.skipBaseline) {
    run(path.join(scripts, 'build_baseline.js'), [
      '--input', input,
      '--output', output,
      ...pageArgs,
    ]);
  }

  console.log('\nDone.');
  console.log(`- Rendered data : ${path.join(output, 'rendered')}`);
  console.log(`- Screenshots   : ${path.join(output, 'screenshots')}`);
  console.log(`- Baselines     : ${path.join(output, 'baseline')}`);
  if (args.ocr) console.log(`- OCR           : ${path.join(output, 'ocr')}`);
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
}
