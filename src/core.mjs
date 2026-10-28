// 初期カテゴリ。保存先に設定がないとき、また読み込めないときに使う。value は投稿に保存される識別子。
export const DEFAULT_CATEGORIES = Object.freeze([
  { value: 'snack', label: 'おやつ', color: '#f5a3a3' },
  { value: 'main', label: 'メイン', color: '#f4b860' },
  { value: 'side', label: '副菜', color: '#9fd3a0' },
  { value: 'soup', label: 'スープ・汁物', color: '#7fc8e8' },
  { value: 'kickboxing', label: 'キックボクシング', color: '#e5776f' },
  { value: 'it', label: 'IT関連', color: '#a8a4e6' },
  { value: 'beauty', label: '美容', color: '#e3a8e0' },
  { value: 'other', label: 'その他', color: '#c9b79c' }
].map(item => Object.freeze(item)));
export const CATEGORIES = DEFAULT_CATEGORIES;
// 新しいカテゴリに順に割り当てる色。白いカードの上でも枠線として見える、中くらいの濃さ。
export const CATEGORY_PALETTE = Object.freeze(['#f5a3a3', '#f4b860', '#9fd3a0', '#7fc8e8', '#e5776f', '#a8a4e6', '#e3a8e0', '#c9b79c', '#8fd1c2', '#f2d16b']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DARK_TEXT = '#3a2a1a';
export const CATEGORY_LIMITS = Object.freeze({ maxItems: 30, maxLabel: 20 });
const CATEGORY_ID = /^[a-z0-9_]{1,24}$/;

const LEGACY_CATEGORIES = Object.freeze({ dessert: 'snack', ai: 'it', salad: 'other', bread: 'other', drink: 'other' });
export const asText = value => typeof value === 'string' ? value : '';

const hasCategory = (categories, value) => categories.some(item => item.value === value);
// 一覧にないカテゴリ（削除済みなど）は「その他」、その他もなければ未分類として扱う。
const fallbackCategory = categories => hasCategory(categories, 'other') ? 'other' : '';

export function normalizeCategory(value, categories = DEFAULT_CATEGORIES) {
  const category = asText(value);
  if (!category) return '';
  if (Object.hasOwn(LEGACY_CATEGORIES, category)) {
    const mapped = LEGACY_CATEGORIES[category];
    return hasCategory(categories, mapped) ? mapped : fallbackCategory(categories);
  }
  return hasCategory(categories, category) ? category : fallbackCategory(categories);
}

export function categoryLabel(value, categories = DEFAULT_CATEGORIES) {
  const category = normalizeCategory(value, categories);
  return categories.find(item => item.value === category)?.label || '';
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// 背景色の上で読みやすい文字色（濃い茶色か白のうち、コントラストが高い方）。
export function readableTextColor(background) {
  if (!COLOR_PATTERN.test(asText(background))) return DARK_TEXT;
  const light = luminance(background);
  const withWhite = 1.05 / (light + 0.05);
  const withDark = (light + 0.05) / (luminance(DARK_TEXT) + 0.05);
  return withWhite > withDark ? '#ffffff' : DARK_TEXT;
}
// まだ使われていないパレットの色。全部使われていたら順番に使い回す。
export function nextPaletteColor(used) {
  const taken = new Set(used.map(color => asText(color).toLowerCase()));
  return CATEGORY_PALETTE.find(color => !taken.has(color)) ?? CATEGORY_PALETTE[taken.size % CATEGORY_PALETTE.length];
}
// カテゴリの色。設定にない・色がないときは空文字（カテゴリなしと同じ見た目）。
export function categoryColor(value, categories = DEFAULT_CATEGORIES) {
  const category = normalizeCategory(value, categories);
  const color = asText(categories.find(item => item.value === category)?.color);
  return COLOR_PATTERN.test(color) ? color.toLowerCase() : '';
}
// 色のないカテゴリに、同じ識別子の初期色か、使われていないパレットの色を付ける。
function fillColors(items) {
  const initialColor = item => DEFAULT_CATEGORIES.find(initial => initial.value === item.value)?.color;
  // 初期カテゴリの色は先に確保して、新しいカテゴリの色と重ならないようにする。
  const used = [...items.map(item => item.color), ...items.filter(item => !item.color).map(initialColor)].filter(Boolean);
  return items.map(item => {
    if (item.color) return item;
    const color = initialColor(item) ?? nextPaletteColor(used);
    used.push(color);
    return { ...item, color };
  });
}

// 編集画面から届いたカテゴリ一覧を検証して整える。問題があれば画面に出せる日本語の理由で例外にする。
export function validateCategories(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('カテゴリを1つ以上残してください。');
  if (items.length > CATEGORY_LIMITS.maxItems) throw new Error(`カテゴリは${CATEGORY_LIMITS.maxItems}個までです。`);
  const values = new Set();
  const labels = new Set();
  const normalized = items.map(item => {
    const value = asText(item?.value);
    const label = asText(item?.label).trim();
    const color = asText(item?.color).trim().toLowerCase();
    if (color && !COLOR_PATTERN.test(color)) throw new Error('カテゴリの色の指定が正しくありません。');
    if (!CATEGORY_ID.test(value)) throw new Error('カテゴリの識別子が正しくありません。');
    if (!label) throw new Error('カテゴリ名を入力してください。');
    if (label.length > CATEGORY_LIMITS.maxLabel) throw new Error(`カテゴリ名は${CATEGORY_LIMITS.maxLabel}文字以内で入力してください。`);
    if (values.has(value)) throw new Error('カテゴリの識別子が重複しています。');
    if (labels.has(label)) throw new Error(`「${label}」が重複しています。別の名前にしてください。`);
    values.add(value);
    labels.add(label);
    return { value, label, color };
  });
  return fillColors(normalized);
}

// 保存先から読んだ設定。形が正しくなければ null（初期カテゴリを使う）。
export function sanitizeCategories(data) {
  try { return validateCategories(data?.items); } catch { return null; }
}

// 新しいカテゴリの識別子。既存と重ならない英数字の文字列。
export function newCategoryId(existing, now = Date.now, random = Math.random) {
  const taken = new Set(existing.map(item => item.value));
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = `c${now().toString(36)}${Math.floor(random() * 46656).toString(36)}`;
    if (!taken.has(id)) return id;
  }
  return `c${taken.size}x${now().toString(36)}`;
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

export function normalizeRecipe(id, data = {}, categories = DEFAULT_CATEGORIES) {
  return {
    id: asText(id),
    post_url: asText(data.post_url),
    thumbnail_url: asText(data.thumbnail_url),
    category: normalizeCategory(data.category, categories),
    memo: asText(data.memo),
    favorite: data.favorite === true,
    saved_date: asText(data.saved_date),
    created_at: asText(data.created_at)
  };
}

export function filterRecipes(recipes, category, search, categories = DEFAULT_CATEGORIES) {
  const query = asText(search).trim().toLocaleLowerCase('ja');
  return recipes.filter(recipe => {
    if (category === 'favorites' ? !recipe.favorite : category && recipe.category !== category) return false;
    return !query || [recipe.memo, recipe.post_url, categoryLabel(recipe.category, categories)]
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
