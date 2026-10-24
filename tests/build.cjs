const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const manifest = require('../dist/manifest.json');
assert.deepEqual(manifest, require('../extension/manifest.json'));
assert.equal(manifest.background.type, 'module');
for (const file of [manifest.background.service_worker, 'sidepanel.js', 'hover.js', 'content.js',
    manifest.side_panel.default_path, 'sidepanel.css', 'licenses/marked.LICENSE']) {
    assert.ok(fs.statSync(path.join(output, file)).isFile(), `缺少产物 ${file}`);
}
for (const name of ['hover', 'content']) {
    // 注入脚本必须可独立作为普通脚本解析，不能残留静态 import/export。
    new vm.Script(fs.readFileSync(path.join(output, `${name}.js`), 'utf8'));
}
const html = fs.readFileSync(path.join(output, 'sidepanel.html'), 'utf8');
assert.match(html, /<script type="module" src="sidepanel\.js"><\/script>/);
assert.doesNotMatch(html, /vendor\/|markdown\.js/);
assert.equal(fs.existsSync(path.join(output, 'vendor')), false);
assert.equal(fs.readFileSync(path.join(output, 'licenses/marked.LICENSE'), 'utf8'),
    fs.readFileSync(path.join(root, 'node_modules/marked/LICENSE'), 'utf8'));
console.log('PASS: standalone extension output, manifest identity/permissions, injected script format and bundled dependency license.');
