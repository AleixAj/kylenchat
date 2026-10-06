// Uploads the installer already built (npm run dist) to a draft on GitHub Releases.
// It uses the GitHub CLI (gh) instead of electron-builder because electron-builder
// sometimes splits the files between two different drafts.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const dist = path.join(__dirname, '..', 'dist');
// Fixed names (without the version) so the download button in the README never changes.
const installer = 'KylenChat-Setup.exe';
const files = [installer, `${installer}.blockmap`, 'latest.yml', 'KylenChat-Portable.zip'].map((f) => path.join(dist, f));

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`Falta ${path.basename(file)}. Ejecuta antes "npm run dist".`);
    process.exit(1);
  }
}

// If the build failed, dist/ still has the files of the previous version: don't upload them.
const built = (fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8').match(/^version:\s*(\S+)/m) || [])[1];
if (built !== version) {
  console.error(`dist/ tiene la versión ${built}, no la ${version}. Vuelve a ejecutar "npm run dist".`);
  process.exit(1);
}

const notes = [
  `## Kylen Chat for Twitch ${version}`,
  '',
  `Descarga **${installer}**, ábrelo y listo. Se actualiza sola.`,
  '',
  '**Mac:** descarga **KylenChat-Mac.dmg** (se añade unos minutos después de publicar), ábrelo y arrastra la app a Aplicaciones. La primera vez, si macOS no la deja abrir: Ajustes del Sistema → Privacidad y seguridad → **Abrir igualmente**.',
  '',
  '¿Prefieres no instalar nada? Descarga **KylenChat-Portable.zip**, descomprímelo y abre "Kylen Chat for Twitch.exe" (esta versión no se actualiza sola).',
  '',
  'Si Windows muestra "Windows protegió tu PC", pulsa **Más información → Ejecutar de todas formas**.',
].join('\n');

execFileSync('gh', [
  'release', 'create', `v${version}`, ...files,
  '--draft', '--title', `Kylen Chat for Twitch ${version}`, '--notes', notes,
], { stdio: 'inherit' });

// The Mac installer can only be built on a Mac, so GitHub Actions does it (.github/workflows/mac.yml).
execFileSync('gh', ['workflow', 'run', 'mac.yml', '-f', `tag=v${version}`], { stdio: 'inherit' });

console.log(`\nBorrador v${version} creado. El de Mac se está compilando en GitHub (unos 10 min). Publícalo cuando esté.`);
