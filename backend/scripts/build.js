const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const frontend = path.join(root, 'frontend');
const dist = path.join(root, 'backend', 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const name of ['index.html', 'styles.css', 'overhaul.css', 'app.js', 'ranking-extension.js', 'portal-extension.js', 'auth-extension.js', 'admin-extension.js', 'project-war-extension.js', 'kommo-extension.js', 'content-overhaul.js', 'site-overhaul.js', 'access-control.js']) {
  fs.copyFileSync(path.join(frontend, 'public', name), path.join(dist, name));
}
fs.copyFileSync(path.join(frontend, 'assets', 'expertaço.png'), path.join(dist, 'expertaço.png'));
fs.copyFileSync(path.join(frontend, 'public', 'catalogo-grupo-abr.pdf'), path.join(dist, 'catalogo-grupo-abr.pdf'));
fs.copyFileSync(path.join(frontend, 'public', 'mascote-animado.gif'), path.join(dist, 'mascote-animado.gif'));
console.log('Build concluído em backend/dist/.');
