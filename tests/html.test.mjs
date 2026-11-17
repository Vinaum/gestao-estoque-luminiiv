// Teste das funções puras de escape. Rodar: node tests/html.test.mjs
import assert from 'node:assert/strict';
import { h, raw, esc } from '../app/js/lib/html.js';
assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(h`<b>${'<i>'}</b>`.s, '<b>&lt;i&gt;</b>');
assert.equal(h`<b>${raw('<i>')}</b>`.s, '<b><i></b>');
assert.equal(h`${['<a>', h`<c>`]}`.s, '&lt;a&gt;<c>');
assert.equal(h`${null}${undefined}${false}${0}`.s, '0');
assert.equal(h`<a title="${'" onmouseover="x'}">`.s, '<a title="&quot; onmouseover=&quot;x">');
console.log('html.test OK');
