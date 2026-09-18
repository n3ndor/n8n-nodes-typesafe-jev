#!/usr/bin/env node
/**
 * Generates the dev variant of the example workflow.
 *
 * n8n registers a node under a different type name depending on how it was
 * loaded. Installed from npm it is `<package>.<node>`; loaded from the dev
 * `custom/` folder by `n8n-node dev` it is `CUSTOM.<node>`. A workflow exported
 * from one will not resolve in the other, failing with "Unrecognized node type".
 *
 * The npm-named file is canonical. This rewrites it so there is nothing to keep
 * in sync by hand.
 *
 *   node scripts/dev-workflow.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'examples/ticket-triage.workflow.json';
const TARGET = 'examples/ticket-triage.dev.workflow.json';
const PACKAGE_PREFIX = 'n8n-nodes-typesafe-jev.';

const workflow = JSON.parse(readFileSync(SOURCE, 'utf8'));

let rewritten = 0;
for (const node of workflow.nodes) {
	if (typeof node.type === 'string' && node.type.startsWith(PACKAGE_PREFIX)) {
		node.type = `CUSTOM.${node.type.slice(PACKAGE_PREFIX.length)}`;
		rewritten += 1;
	}
}

if (rewritten === 0) {
	console.error(`No nodes in ${SOURCE} use the ${PACKAGE_PREFIX} prefix. Nothing written.`);
	process.exit(1);
}

workflow.name = `${workflow.name} (dev)`;

writeFileSync(TARGET, `${JSON.stringify(workflow, null, '\t')}\n`);
console.log(`${TARGET}: rewrote ${rewritten} node type${rewritten === 1 ? '' : 's'} to CUSTOM.*`);
