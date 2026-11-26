const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (['node_modules', 'miniprogram_npm'].includes(item.name)) return [];
    const full = path.join(dir, item.name);
    return item.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root);
for (const file of files.filter((name) => /\.(js|cjs)$/.test(name))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}
for (const file of files.filter((name) => name.endsWith('.json')))
  JSON.parse(fs.readFileSync(file, 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
assert.match(config.appid, /^wx[0-9a-f]{16}$/);
assert.equal(config.compileType, 'miniprogram');
assert.equal(config.miniprogramRoot, './');
assert.equal(new Set(app.pages).size, app.pages.length);
assert.equal(app.tabBar.list.length, 4);
for (const tab of app.tabBar.list)
  assert(app.pages.includes(tab.pagePath), 'Unregistered tab: ' + tab.pagePath);
const componentRoutes = new Set();
for (const file of files.filter((name) => name.endsWith('.json'))) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const value of Object.values(json.usingComponents || {})) {
    const route = value.startsWith('/')
      ? value.slice(1)
      : path.relative(root, path.resolve(path.dirname(file), value));
    componentRoutes.add(route);
  }
}
if (app.tabBar.custom) componentRoutes.add('custom-tab-bar/index');
for (const route of app.pages.concat([...componentRoutes])) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert(
      fs.existsSync(path.join(root, route + '.' + extension)),
      'Missing ' + route + '.' + extension
    );
  }
}

// Structural check only, not the proprietary WeChat WXML compiler.
for (const file of files.filter((name) => name.endsWith('.wxml'))) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tags = source.match(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g) || [];
  for (const tag of tags) {
    const closing = tag.match(/^<\/([\w-]+)\s*>$/);
    if (closing) assert.equal(stack.pop(), closing[1], 'Unbalanced WXML in ' + file);
    else {
      const opening = tag.match(/^<([\w-]+)(?:\s|\/?\>)/);
      assert(opening, 'Invalid tag in ' + file);
      if (!tag.endsWith('/>')) stack.push(opening[1]);
    }
  }
  assert.equal(stack.length, 0, 'Unclosed tags in ' + file);
  for (const match of source.matchAll(/\bsrc="(\/[^"{]+)"/g)) {
    assert(fs.existsSync(path.join(root, match[1].slice(1))), 'Missing asset: ' + match[1]);
  }
  const javascript = fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8');
  for (const match of source.matchAll(/\b(?:bind|catch):?[a-z]+="([A-Za-z][\w]*)"/g)) {
    assert(
      new RegExp('\\b' + match[1] + '\\s*\\(').test(javascript),
      'Missing handler: ' + match[1] + ' in ' + file
    );
  }
}

for (const file of files.filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    assert(
      ['', '.js', '.json'].some((suffix) => fs.existsSync(target + suffix)),
      'Missing module: ' + match[1]
    );
  }
}
const ignored = config.packOptions.ignore || [];
const packedBytes = files
  .filter((file) => {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    return !ignored.some((item) =>
      item.type === 'folder' ? relative.startsWith(item.value + '/') : relative === item.value
    );
  })
  .reduce((total, file) => total + fs.statSync(file).size, 0);
assert(packedBytes < 2 * 1024 * 1024, 'Main package source/assets exceed 2 MiB');
console.log(
  'PASS: JavaScript syntax, JSON config, routes, WXML structure, handlers and local resources.'
);
console.log('Approximate source/assets size: ' + (packedBytes / 1024 / 1024).toFixed(2) + ' MiB.');
console.log(
  'Run native compilation and device checks separately; this script validates source only.'
);
