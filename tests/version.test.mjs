import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Al publicar se sube la versión en index.html (css y js) y en version.json; deben coincidir
// para que el aviso de "versión nueva" funcione.
test('la versión de index.html coincide con version.json', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const published = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version;
    const jsVersion = html.match(/js\/app\.js\?v=([^"]+)"/)?.[1];
    const cssVersion = html.match(/css\/styles\.css\?v=([^"]+)"/)?.[1];
    assert.equal(jsVersion, published);
    assert.equal(cssVersion, published);
});
