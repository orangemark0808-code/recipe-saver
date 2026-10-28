import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSharedUrl, handleShareRequest, takeSharedInbox } from '../src/share.mjs';

const base = 'https://example.github.io/recipe-saver/';
// Cache API の代わりに、保存・取得・削除だけを再現する。
function fakeCaches() {
  const store = new Map();
  const cache = {
    async put(key, response) { store.set(key, response); },
    async match(key) { return store.get(key)?.clone(); },
    async delete(key) { return store.delete(key); }
  };
  return { store, open: async () => cache };
}
const shareRequest = fields => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(`${base}share-target`, { method: 'POST', body: form });
};

test('共有された文章からURLだけを取り出し、追跡用の項目を消す', () => {
  assert.equal(extractSharedUrl({ text: 'おいしそう！ https://www.instagram.com/p/ABC123/?igsh=tracking を見て' }), 'https://www.instagram.com/p/ABC123/');
  assert.equal(extractSharedUrl({ text: '「https://www.instagram.com/reel/XYZ/」です。' }), 'https://www.instagram.com/reel/XYZ/');
  assert.equal(extractSharedUrl({ url: 'https://example.com/a', text: 'https://example.com/b' }), 'https://example.com/a');
  assert.equal(extractSharedUrl({ text: 'URLなし', title: '' }), '');
  assert.equal(extractSharedUrl({ text: 'javascript:alert(1)' }), '');
  assert.equal(extractSharedUrl(), '');
});

test('共有された画像とURLを保存して、アプリ本体へ移動させる', async () => {
  const caches = fakeCaches();
  const image = new File([new Uint8Array([1, 2, 3, 4])], 'スクショ.png', { type: 'image/png' });
  const response = await handleShareRequest(shareRequest({ image, text: 'https://www.instagram.com/p/ABC123/?igsh=x' }), caches, base);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `${base}?share=1`);
  const shared = await takeSharedInbox(caches, base);
  assert.equal(shared.url, 'https://www.instagram.com/p/ABC123/');
  assert.equal(shared.file.name, 'スクショ.png');
  assert.equal(shared.file.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await shared.file.arrayBuffer())], [1, 2, 3, 4]);
  // 取り出したら消える。2回目は何もない。
  assert.equal(await takeSharedInbox(caches, base), null);
  assert.equal(caches.store.size, 0);
});

test('URLだけの共有、画像だけの共有でも受け取れる', async () => {
  const urlOnly = fakeCaches();
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/ONLY/' }), urlOnly, base);
  const first = await takeSharedInbox(urlOnly, base);
  assert.equal(first.url, 'https://www.instagram.com/p/ONLY/');
  assert.equal(first.file, null);
  const imageOnly = fakeCaches();
  await handleShareRequest(shareRequest({ image: new File([new Uint8Array([9])], 'a.jpg', { type: 'image/jpeg' }) }), imageOnly, base);
  const second = await takeSharedInbox(imageOnly, base);
  assert.equal(second.url, '');
  assert.equal(second.file.type, 'image/jpeg');
});

test('前回の取り残しは新しい共有で消え、読み取りに失敗しても画面は開く', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ image: new File([new Uint8Array([1])], 'old.png', { type: 'image/png' }), text: 'https://example.com/old' }), caches, base);
  await handleShareRequest(shareRequest({ text: 'https://example.com/new' }), caches, base);
  const shared = await takeSharedInbox(caches, base);
  assert.equal(shared.url, 'https://example.com/new');
  assert.equal(shared.file, null);
  const broken = await handleShareRequest(new Request(`${base}share-target`, { method: 'POST', body: 'not multipart', headers: { 'Content-Type': 'text/plain' } }), fakeCaches(), base);
  assert.equal(broken.status, 303);
});
