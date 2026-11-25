#!/usr/bin/env node
// Builds the private dev copy from the prod script: same code, [Stats] console report on,
// its own name and no update URL (it must never be published or auto-replaced).
// Usage: node build.js   ->   Boosteroid-Optimizer-Plus.dev.user.js
// Install only one of the two in the userscript manager at a time.
const fs = require('fs');
const path = require('path');

const PROD = path.join(__dirname, 'Boosteroid-Optimizer-Plus.user.js');
const DEV = path.join(__dirname, 'Boosteroid-Optimizer-Plus.dev.user.js');

let src = fs.readFileSync(PROD, 'utf8');
const swap = (from, to) => {
  if (!from.test(src)) throw new Error('build.js: pattern not found: ' + from);
  src = src.replace(from, to);
};
swap(/const DEV_BUILD = false;/, 'const DEV_BUILD = true;');
swap(/^(\/\/ @name\s+)Boosteroid Optimizer Plus$/m, '$1Boosteroid Optimizer Plus DEV');
swap(/^\/\/ @updateURL.*\r?\n/m, '');
swap(/^\/\/ @downloadURL.*\r?\n/m, '');
// Build stamp in the version, so a pasted console says which dev copy produced it
const stamp = new Date().toISOString().slice(5, 16).replace(/[-:]/g, '').replace('T', '-');
swap(/(const SCRIPT_VERSION = '[^']+)';/, `$1-dev.${stamp}';`);

fs.writeFileSync(DEV, src);
console.log('dev build written:', path.basename(DEV), stamp);
