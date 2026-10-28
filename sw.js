import { handleShareRequest } from './src/share.mjs';

// 共有メニューから届いたPOSTだけを受け取る。画面ファイルは保存しないので古い画面が残らない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'POST') return;
  if (new URL(request.url).pathname !== new URL('share-target', self.registration.scope).pathname) return;
  event.respondWith(handleShareRequest(request, caches, self.registration.scope));
});
