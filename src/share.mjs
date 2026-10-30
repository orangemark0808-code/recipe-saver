import { OCR_IMAGE_LIMIT, asText, normalizePostUrl } from './core.mjs';

// 共有メニュー（Web Share Target）で届いた内容を「下書き」として一時保存する。
// 共有のたびに画面が作り直されるため、URLとスクショを別々に共有しても1つの下書きに合体させる。
// service worker（共有の受け取り）とページ（入力中の内容の自動保存）が同じ下書きを使う。
export const SHARE_CACHE = 'recipe-saver-share-inbox';
// 下書きの有効期間。最後の更新からこの時間を過ぎると、次の共有では使わない。
export const DRAFT_MAX_AGE_MS = 10 * 60 * 1000;
// 画像は、カバー画像（保存する）1枚と、文字読み取り用の画像（保存しない）最大 OCR_IMAGE_LIMIT 枚。
const shareKeys = base => ({
  image: new URL('__shared__/image', base).href,
  ocrImages: Array.from({ length: OCR_IMAGE_LIMIT }, (_, index) => new URL(`__shared__/ocr-image-${index}`, base).href),
  text: new URL('__shared__/text', base).href
});
async function deleteImages(cache, keys) {
  await cache.delete(keys.image);
  for (const key of keys.ocrImages) await cache.delete(key);
}
async function deleteAll(cache, keys) {
  await cache.delete(keys.text);
  await deleteImages(cache, keys);
}

// 共有された文章の中からURLを1つ取り出す（Instagramは文章にURLが混ざって届く）。
export function extractSharedUrl({ url = '', text = '', title = '' } = {}) {
  for (const source of [url, text, title]) {
    const found = asText(source).match(/https?:\/\/[^\s<>"'」）。、]+/);
    if (!found) continue;
    try { return normalizePostUrl(found[0]); } catch {}
  }
  return '';
}

// dropped：上限を超えたため、共有されたのに入れられなかった画像の枚数（ページでお知らせする）。
async function readDraft(cache, keys, now) {
  const textResponse = await cache.match(keys.text);
  if (!textResponse) { await deleteImages(cache, keys); return null; }
  let meta = {};
  try { meta = await textResponse.json(); } catch {}
  const savedAt = Number(meta.savedAt);
  if (!(now - savedAt <= DRAFT_MAX_AGE_MS)) { await deleteAll(cache, keys); return null; }
  const file = await readImage(cache, keys.image);
  const ocrFiles = [];
  for (const key of keys.ocrImages) {
    const ocrFile = await readImage(cache, key);
    if (ocrFile) ocrFiles.push(ocrFile);
  }
  const dropped = Number.isInteger(meta.dropped) && meta.dropped > 0 ? meta.dropped : 0;
  return { url: asText(meta.url), memo: asText(meta.memo), category: asText(meta.category), file, ocrFiles, dropped };
}
async function readImage(cache, key) {
  const response = await cache.match(key);
  if (!response) return null;
  const blob = await response.blob();
  const name = decodeURIComponent(response.headers.get('X-File-Name') || 'shared');
  return new File([blob], name, { type: blob.type });
}

async function writeText(cache, keys, { url, memo, category, dropped = 0 }, now) {
  await cache.put(keys.text, new Response(JSON.stringify({ url, memo, category, dropped, savedAt: now }), {
    headers: { 'Content-Type': 'application/json' }
  }));
}
async function writeImage(cache, key, file) {
  if (!file) { await cache.delete(key); return; }
  await cache.put(key, new Response(file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'shared') }
  }));
}
// 文字読み取り用の画像を、並び順どおりに書き直す（余った置き場は空にする）。
async function writeOcrImages(cache, keys, files) {
  for (const [index, key] of keys.ocrImages.entries()) await writeImage(cache, key, files[index] || null);
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
// ページ側：カバー画像を保存する（null で削除）。
export async function saveDraftImage(caches, base, file) {
  const cache = await caches.open(SHARE_CACHE);
  await writeImage(cache, shareKeys(base).image, file);
}
// ページ側：文字読み取り用の画像の一覧を保存する（空の配列ですべて削除）。
export async function saveDraftOcrImages(caches, base, files) {
  const cache = await caches.open(SHARE_CACHE);
  await writeOcrImages(cache, shareKeys(base), files.slice(0, OCR_IMAGE_LIMIT));
}
export async function clearDraft(caches, base) {
  const cache = await caches.open(SHARE_CACHE);
  await deleteAll(cache, shareKeys(base));
}

// service worker 側。共有のPOSTを今の下書きに合体させて保存し、アプリ本体へ移動させる。
// 新しいURLがあればそれを使い、なければ前の内容を残す。失敗しても画面は開く。
// 画像は、カバーが空ならカバーへ。カバーがあれば文字読み取り用の一覧の末尾へ追加する（カバーは上書きしない）。
// 一覧が上限に達したら追加せず、入れられなかった枚数を下書きに残す。
export async function handleShareRequest(request, caches, base, now = Date.now()) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const keys = shareKeys(base);
    const draft = await readDraft(cache, keys, now);
    const url = extractSharedUrl({ url: form.get('url'), text: form.get('text'), title: form.get('title') });
    const images = form.getAll('image').filter(image => image && typeof image === 'object' && image.size > 0);
    let cover = draft?.file || null;
    const ocrFiles = [...(draft?.ocrFiles || [])];
    let dropped = draft?.dropped || 0;
    let coverChanged = false;
    for (const image of images) {
      if (!cover) { cover = image; coverChanged = true; }
      else if (ocrFiles.length < OCR_IMAGE_LIMIT) ocrFiles.push(image);
      else dropped++;
    }
    await writeText(cache, keys, {
      url: url || draft?.url || '',
      memo: draft?.memo || '',
      category: draft?.category || '',
      dropped
    }, now);
    if (coverChanged) await writeImage(cache, keys.image, cover);
    // 前からある画像は書き直さず、新しく追加した分だけを書く。
    const before = draft?.ocrFiles?.length || 0;
    for (let index = before; index < ocrFiles.length; index++) await writeImage(cache, keys.ocrImages[index], ocrFiles[index]);
  } catch {}
  return Response.redirect(new URL('./?share=1', base).href, 303);
}
