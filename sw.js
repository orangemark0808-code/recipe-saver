import { handleShareRequest } from './src/share.mjs';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // 共有メニューから届いたPOSTを受け取る。
  if (request.method === 'POST') {
    if (url.pathname !== new URL('share-target', self.registration.scope).pathname) return;
    event.respondWith(handleShareRequest(request, caches, self.registration.scope));
    return;
  }
  // 同じサイトのファイルは、配信元の10分間のキャッシュに頼らず、毎回「変わっていないか」を確認する。
  // 変わっていなければ数バイトの確認だけで済み、更新直後に新旧のファイルが混ざって表示が崩れるのを防ぐ。
  if (request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
  }
});
