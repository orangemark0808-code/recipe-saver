import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.RECIPE_PREVIEW_PORT || 4173);
const allowed = new Set(['index.html', 'index_v28.html', 'styles.css', 'src/main.mjs', 'src/core.mjs', 'src/view.mjs', 'src/controller.mjs', 'src/backend.mjs', 'src/config.mjs', 'favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'sw.js', 'src/share.mjs', 'icon-192.png', 'icon-512.png']);
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // プレビューから外部へ通信しないことをブラウザ側でも強制する。
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    let filename = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (filename === '__preview__/image.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="960"><rect width="320" height="960" fill="#fff1e7"/><text x="160" y="160" text-anchor="middle" fill="#a84d05" font-size="22">画像の上端</text><text x="160" y="480" text-anchor="middle" fill="#a84d05" font-size="20">縦長スクショの確認</text><text x="160" y="900" text-anchor="middle" fill="#a84d05" font-size="22">画像の下端</text></svg>');
      return;
    }
    if (!allowed.has(filename)) { response.writeHead(404); response.end('Not found'); return; }
    if (filename === 'src/backend.mjs') filename = 'tests/fixtures/preview-backend.mjs';
    if (filename === 'src/config.mjs') filename = 'tests/fixtures/preview-config.mjs';
    // PNGなどの画像はバイナリのまま返す。
    let content = await readFile(path.join(root, filename));
    if (filename === 'index.html') {
      content = content.toString('utf8').replace('<body>', '<body><aside class="preview-banner">ローカル確認用・架空データ / 本番への接続なし</aside>');
    }
    const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript; charset=utf-8' };
    response.setHeader('Content-Type', types[path.extname(filename)] || (filename.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'));
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(500); response.end('Preview server error'); }
});
server.listen(port, '127.0.0.1', () => console.log(`LOCAL PREVIEW: http://127.0.0.1:${port} (synthetic data only)`));
