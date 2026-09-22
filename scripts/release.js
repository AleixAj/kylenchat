// Sube el instalador ya creado (npm run dist) a un borrador de GitHub Releases.
// Se usa la CLI de GitHub (gh) en vez de electron-builder porque este a veces
// reparte los archivos en dos borradores distintos.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const dist = path.join(__dirname, '..', 'dist');
const installer = `KylenChat-Setup-${version}.exe`;
const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`Falta ${path.basename(file)}. Ejecuta antes "npm run dist".`);
    process.exit(1);
  }
}

const notes = [
  `## Kylen Chat for Twitch ${version}`,
  '',
  `Descarga **${installer}**, ábrelo y listo.`,
  '',
  'Si Windows muestra "Windows protegió tu PC", pulsa **Más información → Ejecutar de todas formas**.',
].join('\n');

execFileSync('gh', [
  'release', 'create', `v${version}`, ...files,
  '--draft', '--title', `Kylen Chat for Twitch ${version}`, '--notes', notes,
], { stdio: 'inherit' });

console.log(`\nBorrador v${version} creado. Publícalo desde GitHub cuando quieras.`);
