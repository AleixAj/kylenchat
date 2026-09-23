// Sube el instalador ya creado (npm run dist) a un borrador de GitHub Releases.
// Se usa la CLI de GitHub (gh) en vez de electron-builder porque este a veces
// reparte los archivos en dos borradores distintos.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const dist = path.join(__dirname, '..', 'dist');
// Nombres fijos (sin versión) para que el botón de descarga del README no cambie nunca.
const installer = 'KylenChat-Setup.exe';
const files = [installer, `${installer}.blockmap`, 'latest.yml', 'KylenChat-Portable.zip'].map((f) => path.join(dist, f));

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`Falta ${path.basename(file)}. Ejecuta antes "npm run dist".`);
    process.exit(1);
  }
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

// El instalador de Mac solo se puede crear en un Mac: lo hace GitHub Actions (.github/workflows/mac.yml).
execFileSync('gh', ['workflow', 'run', 'mac.yml', '-f', `tag=v${version}`], { stdio: 'inherit' });

console.log(`\nBorrador v${version} creado. El de Mac se está compilando en GitHub (unos 10 min). Publícalo cuando esté.`);
