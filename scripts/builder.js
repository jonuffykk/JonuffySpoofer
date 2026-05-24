'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const { version = '1.0.0' } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outPath = path.join(dist, `JonuffySpoofer-v${version}.rbxmx`);

const esc = v =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const refId = n => `RBX_${n.replace(/[^A-Za-z0-9_]/g, '_')}`;

fs.mkdirSync(dist, { recursive: true });
const source = fs.readFileSync(path.join(root, 'scripts', 'plugin.lua'), 'utf8');

const xml = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Folder" referent="${refId('Root')}">
    <Properties>
      <string name="Name">JonuffySpoofer</string>
    </Properties>
    <Item class="Script" referent="${refId('JonuffySpooferPlugin')}">
      <Properties>
        <bool name="Disabled">false</bool>
        <Content name="LinkedSource"><null></null></Content>
        <string name="Name">JonuffySpoofer</string>
        <ProtectedString name="Source">${esc(source)}</ProtectedString>
      </Properties>
    </Item>
  </Item>
</roblox>`;

fs.writeFileSync(outPath, xml, 'utf8');
console.log(`Built: ${outPath}`);
