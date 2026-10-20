#!/usr/bin/env node
/**
 * Remove SKILL.md files shipped by npm dependencies.
 *
 * OpenCode scans every SKILL.md under a skills root, including files nested in
 * node_modules. playwright-core ships its own agent skills under
 * lib/tools/skills, which would otherwise be registered as separate skills
 * next to axure-analyzer.
 *
 * Runs as the package postinstall and is also called by install.ps1/install.sh
 * after npm install, so it also covers installs made with --ignore-scripts.
 */
const fs = require("node:fs");
const path = require("node:path");

const nodeModules = path.resolve(__dirname, "..", "node_modules");
let removed = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    try {
      fs.rmSync(fullPath, { force: true });
      removed += 1;
    } catch (error) {
      console.warn(`[axure-analyzer] could not remove ${fullPath}: ${error.message}`);
    }
  }
}

if (fs.existsSync(nodeModules)) {
  walk(nodeModules);
}

if (removed > 0) {
  console.log(`[axure-analyzer] removed ${removed} nested SKILL.md file(s) from node_modules`);
}
