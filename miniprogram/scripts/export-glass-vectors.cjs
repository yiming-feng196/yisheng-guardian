// Optional development tooling: install sharp in scripts/node_modules.
// Run export-glass-art.py first; SVG sources in design/ remain editable.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

async function exportVectors() {
  for (const name of ['leaf', 'server', 'layers', 'wifi', 'info', 'logout']) {
    await sharp(path.join(root, 'design', name + '.svg'))
      .resize(81, 81)
      .png()
      .toFile(path.join(root, 'assets/icons', name + '.png'));
  }
  await sharp(path.join(root, 'design/ginkgo-glass.svg'))
    .resize(315, 345)
    .png()
    .toFile(path.join(root, 'assets/ginkgo-glass.png'));
  const background = await sharp(path.join(root, 'assets/scene-atmosphere.png'))
    .composite([{ input: path.join(root, 'design/scene-curves.svg') }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(root, 'assets/scene-atmosphere.png'), background);
  console.log('Exported six line icons, ginkgo and atmosphere curves.');
}

exportVectors().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
