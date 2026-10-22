// Windows PowerShell 5.1 lee los .ps1 sin BOM con la página de códigos ANSI: un carácter fuera de
// ASCII (una tilde, un ✳) llega roto y el script falla sin avisar. Tienen que ser ASCII puro.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
function ps1(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'datos' ? [] : ps1(p);
    return e.name.endsWith('.ps1') ? [p] : [];
  });
}

test('los scripts de PowerShell son ASCII puro', () => {
  const archivos = ps1(raiz);
  assert.ok(archivos.length >= 4);
  for (const f of archivos) {
    const malos = [...fs.readFileSync(f)].filter((b) => b > 127).length;
    assert.equal(malos, 0, `${path.relative(raiz, f)} tiene ${malos} bytes fuera de ASCII`);
  }
});
