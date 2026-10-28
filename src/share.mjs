import { asText, normalizePostUrl } from './core.mjs';

// 共有メニュー（Web Share Target）で届いた内容の受け渡し。
// service worker が受け取った画像・URLを Cache API に一時保存し、ページ側が読み出して消す。
export const SHARE_CACHE = 'recipe-saver-share-inbox';
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

// service worker 側。共有のPOSTを保存し、アプリ本体へ移動させる。失敗しても画面は開く。
export async function handleShareRequest(request, caches, base) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const keys = shareKeys(base);
    // 前回の取り残しが混ざらないよう、先に消す。
    await cache.delete(keys.image);
    await cache.delete(keys.text);
    const file = form.get('image');
    if (file && typeof file === 'object' && file.size > 0) {
      await cache.put(keys.image, new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared') }
      }));
    }
    const url = extractSharedUrl({ url: form.get('url'), text: form.get('text'), title: form.get('title') });
    if (url) {
      await cache.put(keys.text, new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json' } }));
    }
  } catch {}
  return Response.redirect(new URL('./?share=1', base).href, 303);
}

// ページ側。保存された内容を1回だけ取り出して消す。何もなければ null。
export async function takeSharedInbox(caches, base) {
  const cache = await caches.open(SHARE_CACHE);
  const keys = shareKeys(base);
  const imageResponse = await cache.match(keys.image);
  const textResponse = await cache.match(keys.text);
  await cache.delete(keys.image);
  await cache.delete(keys.text);
  let file = null;
  if (imageResponse) {
    const blob = await imageResponse.blob();
    const name = decodeURIComponent(imageResponse.headers.get('X-File-Name') || 'shared');
    file = new File([blob], name, { type: blob.type });
  }
  let url = '';
  if (textResponse) url = asText((await textResponse.json()).url);
  return file || url ? { url, file } : null;
}
