import { asText, normalizePostUrl } from './core.mjs';

// 共有メニュー（Web Share Target）で届いた内容を「下書き」として一時保存する。
// 共有のたびに画面が作り直されるため、URLとスクショを別々に共有しても1つの下書きに合体させる。
// service worker（共有の受け取り）とページ（入力中の内容の自動保存）が同じ下書きを使う。
export const SHARE_CACHE = 'recipe-saver-share-inbox';
// 下書きの有効期間。最後の更新からこの時間を過ぎると、次の共有では使わない。
export const DRAFT_MAX_AGE_MS = 10 * 60 * 1000;
const shareKeys = base => ({
  image: new URL('__shared__/image', base).href,
  text: new URL('__shared__/text', base).href
});

// 共有された文章の中からURLを1つ取り出す（Instagramは文章にURLが混ざって届く）。
export function extractSharedUrl({ url = '', text = '', title = '' } = {}) {
  for (const source of [url, text, title]) {
    const found = asText(source).match(/https?:\/\/[^\s<>"'」）。、]+/);
    if (!found) continue;
    try { return normalizePostUrl(found[0]); } catch {}
  }
  return '';
}

async function readDraft(cache, keys, now) {
  const textResponse = await cache.match(keys.text);
  if (!textResponse) { await cache.delete(keys.image); return null; }
  let meta = {};
  try { meta = await textResponse.json(); } catch {}
  const savedAt = Number(meta.savedAt);
  if (!(now - savedAt <= DRAFT_MAX_AGE_MS)) {
    await cache.delete(keys.text);
    await cache.delete(keys.image);
    return null;
  }
  let file = null;
  const imageResponse = await cache.match(keys.image);
  if (imageResponse) {
    const blob = await imageResponse.blob();
    const name = decodeURIComponent(imageResponse.headers.get('X-File-Name') || 'shared');
    file = new File([blob], name, { type: blob.type });
  }
  return { url: asText(meta.url), memo: asText(meta.memo), category: asText(meta.category), file };
}

async function writeText(cache, keys, { url, memo, category }, now) {
  await cache.put(keys.text, new Response(JSON.stringify({ url, memo, category, savedAt: now }), {
    headers: { 'Content-Type': 'application/json' }
  }));
}
async function writeImage(cache, keys, file) {
  if (!file) { await cache.delete(keys.image); return; }
  await cache.put(keys.image, new Response(file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared') }
  }));
}

// 保存されている下書き。なければ・期限切れなら null。取り出しても消さない（保存やクリアで消える）。
export async function loadDraft(caches, base, now = Date.now()) {
  const cache = await caches.open(SHARE_CACHE);
  return readDraft(cache, shareKeys(base), now);
}
// ページ側：入力中のURL・メモ・カテゴリを保存する。
export async function saveDraft(caches, base, { url = '', memo = '', category = '' }, now = Date.now()) {
  const cache = await caches.open(SHARE_CACHE);
  await writeText(cache, shareKeys(base), { url, memo, category }, now);
}
// ページ側：選んだ画像を保存する（null で削除）。
export async function saveDraftImage(caches, base, file) {
  const cache = await caches.open(SHARE_CACHE);
  await writeImage(cache, shareKeys(base), file);
}
export async function clearDraft(caches, base) {
  const cache = await caches.open(SHARE_CACHE);
  const keys = shareKeys(base);
  await cache.delete(keys.text);
  await cache.delete(keys.image);
}

// service worker 側。共有のPOSTを今の下書きに合体させて保存し、アプリ本体へ移動させる。
// 新しいURL・画像があればそれを使い、なければ前の内容を残す。失敗しても画面は開く。
export async function handleShareRequest(request, caches, base, now = Date.now()) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const keys = shareKeys(base);
    const draft = await readDraft(cache, keys, now);
    const url = extractSharedUrl({ url: form.get('url'), text: form.get('text'), title: form.get('title') });
    const image = form.get('image');
    const file = image && typeof image === 'object' && image.size > 0 ? image : null;
    await writeText(cache, keys, {
      url: url || draft?.url || '',
      memo: draft?.memo || '',
      category: draft?.category || ''
    }, now);
    if (file) await writeImage(cache, keys, file);
  } catch {}
  return Response.redirect(new URL('./?share=1', base).href, 303);
}
