'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const { version = '1.0.0' } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outPath = path.join(dist, `JonuffySpoofer-v${version}.rbxmx`);

const escapeXml = v =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const refId = name => `RBX_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
const propString = (k, v) => `<string name="${k}">${escapeXml(v)}</string>`;
const propBool = (k, v) => `<bool name="${k}">${v}</bool>`;
const protectedSource = v => `<ProtectedString name="Source">${escapeXml(v)}</ProtectedString>`;

const scriptItem = (cls, ref, name, source) => `
  <Item class="${cls}" referent="${refId(ref)}">
    <Properties>
      ${propBool('Disabled', false)}
      <Content name="LinkedSource"><null></null></Content>
      ${propString('Name', name)}
      ${protectedSource(source)}
    </Properties>
  </Item>`;

fs.mkdirSync(dist, { recursive: true });

const source = fs.readFileSync(path.join(root, 'scripts', 'plugin.lua'), 'utf8');

const xml = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Folder" referent="${refId('Root')}">
    <Properties>
      ${propString('Name', 'JonuffySpoofer')}
    </Properties>
    ${scriptItem('Script', 'JonuffySpooferPlugin', 'JonuffySpoofer', source)}
  </Item>
</roblox>`;

fs.writeFileSync(outPath, xml, 'utf8');
console.log(`Built: ${outPath}`);
