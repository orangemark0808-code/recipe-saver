import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_MAX_AGE_MS, clearDraft, extractSharedUrl, handleShareRequest, loadDraft, saveDraft, saveDraftImage, saveDraftOcrImages } from '../src/share.mjs';

const base = 'https://example.github.io/recipe-saver/';
const T0 = 1_000_000_000_000;
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
const png = (name, bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
const bytesOf = async file => [...new Uint8Array(await file.arrayBuffer())];

test('共有された文章からURLだけを取り出し、追跡用の項目を消す', () => {
  assert.equal(extractSharedUrl({ text: 'おいしそう！ https://www.instagram.com/p/ABC123/?igsh=tracking を見て' }), 'https://www.instagram.com/p/ABC123/');
  assert.equal(extractSharedUrl({ text: '「https://www.instagram.com/reel/XYZ/」です。' }), 'https://www.instagram.com/reel/XYZ/');
  assert.equal(extractSharedUrl({ url: 'https://example.com/a', text: 'https://example.com/b' }), 'https://example.com/a');
  assert.equal(extractSharedUrl({ text: 'URLなし', title: '' }), '');
  assert.equal(extractSharedUrl({ text: 'javascript:alert(1)' }), '');
  assert.equal(extractSharedUrl(), '');
});

test('共有された画像とURLを下書きに保存し、アプリ本体へ移動させる。取り出しても消えない', async () => {
  const caches = fakeCaches();
  const response = await handleShareRequest(shareRequest({ image: png('スクショ.png', [1, 2, 3, 4]), text: 'https://www.instagram.com/p/ABC123/?igsh=x' }), caches, base, T0);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `${base}?share=1`);
  for (let i = 0; i < 2; i++) {
    const draft = await loadDraft(caches, base, T0 + 1000);
    assert.equal(draft.url, 'https://www.instagram.com/p/ABC123/');
    assert.equal(draft.file.name, 'スクショ.png');
    assert.equal(draft.file.type, 'image/png');
    assert.deepEqual(await bytesOf(draft.file), [1, 2, 3, 4]);
  }
});

test('URLを共有→メモを入力→スクショを共有で、1つの下書きに合体する', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/POST1/' }), caches, base, T0);
  // ページ側が入力中のメモとカテゴリを自動保存する。
  const first = await loadDraft(caches, base, T0 + 1000);
  await saveDraft(caches, base, { ...first, memo: '米粉のクッキー', category: 'snack' }, T0 + 60_000);
  await handleShareRequest(shareRequest({ image: png('shot.png', [7, 8]) }), caches, base, T0 + 120_000);
  const draft = await loadDraft(caches, base, T0 + 121_000);
  assert.equal(draft.url, 'https://www.instagram.com/p/POST1/');
  assert.equal(draft.memo, '米粉のクッキー');
  assert.equal(draft.category, 'snack');
  assert.deepEqual(await bytesOf(draft.file), [7, 8]);
});

test('スクショを共有→URLを共有でも合体し、新しい内容が前の内容を置き換える', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ image: png('a.png', [1]) }), caches, base, T0);
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/LATER/' }), caches, base, T0 + 1000);
  let draft = await loadDraft(caches, base, T0 + 2000);
  assert.equal(draft.url, 'https://www.instagram.com/p/LATER/');
  assert.deepEqual(await bytesOf(draft.file), [1]);
  // URLをもう一度共有したら新しい方に置き換わる。2枚目の画像はカバーを上書きせず、文字読み取り用に入る。
  await handleShareRequest(shareRequest({ image: png('b.png', [2, 2]), text: 'https://www.instagram.com/p/NEWER/' }), caches, base, T0 + 3000);
  draft = await loadDraft(caches, base, T0 + 4000);
  assert.equal(draft.url, 'https://www.instagram.com/p/NEWER/');
  assert.deepEqual(await bytesOf(draft.file), [1]);
  assert.equal(draft.ocrFiles.length, 1);
  assert.deepEqual(await bytesOf(draft.ocrFiles[0]), [2, 2]);
});

test('2枚目以降の画像は文字読み取り用の一覧に順番に追加し、5枚を超えた分は入れずに枚数を残す', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ image: png('cover.png', [0]) }), caches, base, T0);
  let draft = await loadDraft(caches, base, T0 + 1);
  assert.deepEqual(await bytesOf(draft.file), [0]);
  assert.deepEqual(draft.ocrFiles, []);
  assert.equal(draft.dropped, 0);
  for (let i = 1; i <= 7; i++) await handleShareRequest(shareRequest({ image: png(`text${i}.png`, [i]) }), caches, base, T0 + i * 1000);
  draft = await loadDraft(caches, base, T0 + 9000);
  assert.deepEqual(await bytesOf(draft.file), [0]);
  assert.deepEqual(draft.ocrFiles.map(file => file.name), ['text1.png', 'text2.png', 'text3.png', 'text4.png', 'text5.png']);
  assert.equal(draft.dropped, 2);
  // ページ側が入力内容を保存したら、お知らせ済みの枚数は消える。
  await saveDraft(caches, base, draft, T0 + 10_000);
  assert.equal((await loadDraft(caches, base, T0 + 11_000)).dropped, 0);
});

test('一度の共有で複数枚届いたら、カバー→文字読み取り用の順に入れる', async () => {
  const caches = fakeCaches();
  const form = new FormData();
  for (const [name, bytes] of [['a.png', [1]], ['b.png', [2]], ['c.png', [3]]]) form.append('image', png(name, bytes));
  await handleShareRequest(new Request(`${base}share-target`, { method: 'POST', body: form }), caches, base, T0);
  const draft = await loadDraft(caches, base, T0 + 1);
  assert.equal(draft.file.name, 'a.png');
  assert.deepEqual(draft.ocrFiles.map(file => file.name), ['b.png', 'c.png']);
});

test('ページ側で文字読み取り用の画像の一覧を保存・並べ替え・削除でき、クリアですべて消える', async () => {
  const caches = fakeCaches();
  await saveDraft(caches, base, { memo: 'メモ' }, T0);
  await saveDraftImage(caches, base, png('c.png', [1]));
  await saveDraftOcrImages(caches, base, [png('o1.png', [7]), png('o2.png', [8]), png('o3.png', [9])]);
  let draft = await loadDraft(caches, base, T0 + 1);
  assert.deepEqual(await bytesOf(draft.file), [1]);
  assert.deepEqual(draft.ocrFiles.map(file => file.name), ['o1.png', 'o2.png', 'o3.png']);
  // 並べ替え・1枚削除。余った置き場は空になり、カバーは残る。
  await saveDraftOcrImages(caches, base, [draft.ocrFiles[2], draft.ocrFiles[0]]);
  draft = await loadDraft(caches, base, T0 + 1);
  assert.deepEqual(draft.ocrFiles.map(file => file.name), ['o3.png', 'o1.png']);
  assert.deepEqual(await bytesOf(draft.file), [1]);
  await saveDraftOcrImages(caches, base, []);
  assert.deepEqual((await loadDraft(caches, base, T0 + 1)).ocrFiles, []);
  await saveDraftOcrImages(caches, base, [png('o4.png', [4])]);
  await clearDraft(caches, base);
  assert.equal(caches.store.size, 0);
});

test('10分以上たった下書きは合体せず、読み出しでも消える', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/OLD/', image: png('old.png') }), caches, base, T0);
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/FRESH/' }), caches, base, T0 + DRAFT_MAX_AGE_MS + 1);
  const draft = await loadDraft(caches, base, T0 + DRAFT_MAX_AGE_MS + 2);
  assert.equal(draft.url, 'https://www.instagram.com/p/FRESH/');
  assert.equal(draft.file, null);
  assert.equal(await loadDraft(caches, base, T0 + DRAFT_MAX_AGE_MS * 3), null);
  assert.equal(caches.store.size, 0);
});

test('ページ側の保存・画像の追加と削除・クリアが下書きに反映される', async () => {
  const caches = fakeCaches();
  await saveDraft(caches, base, { url: 'https://example.com/a', memo: 'メモ', category: 'main' }, T0);
  await saveDraftImage(caches, base, png('p.png', [5]));
  let draft = await loadDraft(caches, base, T0 + 1000);
  assert.deepEqual([draft.url, draft.memo, draft.category], ['https://example.com/a', 'メモ', 'main']);
  assert.deepEqual(await bytesOf(draft.file), [5]);
  await saveDraftImage(caches, base, null);
  draft = await loadDraft(caches, base, T0 + 1000);
  assert.equal(draft.file, null);
  await clearDraft(caches, base);
  assert.equal(await loadDraft(caches, base, T0 + 1000), null);
  assert.equal(caches.store.size, 0);
});

test('読み取りに失敗しても画面は開き、前の下書きは壊さない', async () => {
  const caches = fakeCaches();
  await handleShareRequest(shareRequest({ text: 'https://www.instagram.com/p/KEEP/' }), caches, base, T0);
  const broken = await handleShareRequest(new Request(`${base}share-target`, { method: 'POST', body: 'not multipart', headers: { 'Content-Type': 'text/plain' } }), caches, base, T0 + 1000);
  assert.equal(broken.status, 303);
  assert.equal((await loadDraft(caches, base, T0 + 2000)).url, 'https://www.instagram.com/p/KEEP/');
});
