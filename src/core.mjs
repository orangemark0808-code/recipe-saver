export const CATEGORIES = Object.freeze([
  { value: 'snack', label: 'おやつ' },
  { value: 'main', label: 'メイン' },
  { value: 'side', label: '副菜' },
  { value: 'soup', label: 'スープ・汁物' },
  { value: 'kickboxing', label: 'キックボクシング' },
  { value: 'it', label: 'IT関連' },
  { value: 'beauty', label: '美容' },
  { value: 'other', label: 'その他' }
]);

const LEGACY_CATEGORIES = Object.freeze({ dessert: 'snack', ai: 'it', salad: 'other', bread: 'other', drink: 'other' });
export const asText = value => typeof value === 'string' ? value : '';

export function normalizeCategory(value) {
  const category = asText(value);
  if (Object.hasOwn(LEGACY_CATEGORIES, category)) return LEGACY_CATEGORIES[category];
  return CATEGORIES.some(item => item.value === category) ? category : category ? 'other' : '';
}

export function categoryLabel(value) {
  return CATEGORIES.find(item => item.value === normalizeCategory(value))?.label || '';
}

export function normalizePostUrl(value) {
  const raw = asText(value).trim();
  if (!raw) return '';
  if (raw.length > 2048) throw new Error('投稿URLは2048文字以内で入力してください。');
  let url;
  try { url = new URL(raw); } catch { throw new Error('https:// から始まる有効な投稿URLを入力してください。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('投稿URLには http:// または https:// のリンクを入力してください。');
  }
  if (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) {
    for (const key of [...url.searchParams.keys()]) {
      if (['igsh', 'igshid', 'fbclid'].includes(key) || key.startsWith('utm_')) url.searchParams.delete(key);
    }
  }
  return url.href;
}

export function safePostUrl(value) {
  try { return normalizePostUrl(value); } catch { return ''; }
}

export function safeImageUrl(value, pageOrigin = '') {
  try {
    const url = new URL(asText(value));
    if (url.username || url.password) return '';
    if (url.protocol === 'https:' && url.hostname === 'res.cloudinary.com') return url.href;
    // ローカルプレビューの画像も同じ描画処理を通す。任意の外部ホストは許可しない。
    if (pageOrigin && url.origin === pageOrigin && ['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch {}
  return '';
}

export function normalizeRecipe(id, data = {}) {
  return {
    id: asText(id),
    post_url: asText(data.post_url),
    thumbnail_url: asText(data.thumbnail_url),
    category: normalizeCategory(data.category),
    memo: asText(data.memo),
    favorite: data.favorite === true,
    saved_date: asText(data.saved_date),
    created_at: asText(data.created_at)
  };
}

export function filterRecipes(recipes, category, search) {
  const query = asText(search).trim().toLocaleLowerCase('ja');
  return recipes.filter(recipe => {
    if (category === 'favorites' ? !recipe.favorite : category && recipe.category !== category) return false;
    return !query || [recipe.memo, recipe.post_url, categoryLabel(recipe.category)]
      .some(text => text.toLocaleLowerCase('ja').includes(query));
  });
}

export function validateMemo(value) {
  const memo = asText(value).trim();
  if (memo.length > 10000) throw new Error('メモは10000文字以内で入力してください。');
  return memo;
}

export function validateImage(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('JPEG・PNG・WebP・GIF画像を選択してください。');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('画像は10MB以下にしてください。');
  return file;
}

// スマホのスクショ（縦長）の上下にあるステータスバー等の余白を切るCloudinary変換。
// top / height は元画像に対する割合。元の画像はCloudinaryに残り、指定を外せば取り出せる。
export const SCREENSHOT_CROP = Object.freeze({ top: 0.08, height: 0.84, minRatio: 1.5 });
const CROP_SEGMENT = /\/c_crop,w_1\.0,h_[\d.]+,y_[\d.]+(?=\/v\d+\/)/;

export function cropScreenshotUrl(value, width, height, crop = SCREENSHOT_CROP) {
  const src = safeImageUrl(value);
  // 縦長でない写真や、すでに変換済みのURLはそのまま返す。
  if (!src || !(width > 0) || !(height / width >= crop.minRatio)) return value;
  const url = new URL(src);
  const match = url.pathname.match(/^(\/[^/]+\/image\/upload\/)(v\d+\/.+)$/);
  if (!match) return value;
  url.pathname = `${match[1]}c_crop,w_1.0,h_${crop.height},y_${crop.top}/${match[2]}`;
  return url.href;
}

// 切り抜き指定を外した元画像のURL。変換が使えない場合の表示用。
export function originalImageUrl(value) {
  const text = asText(value);
  return text.replace(CROP_SEGMENT, '');
}
