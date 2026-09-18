#!/usr/bin/env node
/**
 * Asserts that dist actually contains what package.json tells n8n to load.
 *
 * `n8n-node build` wipes dist before running tsc, so anything that makes tsc
 * skip emitting (stale build info, a misconfigured outDir) leaves an empty dist
 * and still exits 0. This runs as `postbuild` so a broken build fails loudly
 * rather than being published as an empty package.
 */

import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const required = [...(pkg.n8n?.nodes ?? []), ...(pkg.n8n?.credentials ?? [])];

if (required.length === 0) {
	console.error('package.json declares no n8n nodes or credentials.');
	process.exit(1);
}

// Each registered node needs its codex and icons alongside the compiled class.
const companions = (entry) => {
	const base = entry.replace(/\.js$/, '');
	return pkg.n8n?.nodes?.includes(entry) ? [`${base}.json`] : [];
};

const missing = [];
for (const entry of required) {
	for (const file of [entry, ...companions(entry)]) {
		if (!existsSync(new URL(`../${file}`, import.meta.url))) missing.push(file);
	}
}

if (missing.length > 0) {
	console.error('Build produced an incomplete dist. Missing:');
	for (const file of missing) console.error(`  - ${file}`);
	console.error('\nRun `rm -rf dist` and build again.');
	process.exit(1);
}

console.log(`dist verified: ${required.length} registered entr${required.length === 1 ? 'y' : 'ies'} present.`);
