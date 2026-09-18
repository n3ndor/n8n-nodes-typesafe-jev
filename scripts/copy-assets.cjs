const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const source = join('nodes', 'TypeSafeJev', 'typesafeJev.svg');
const destination = join('dist', 'nodes', 'TypeSafeJev', 'typesafeJev.svg');

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination);
