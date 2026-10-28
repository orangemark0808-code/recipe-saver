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
