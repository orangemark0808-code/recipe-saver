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
// ラベル（カテゴリ名のタグ）の背景色と文字色。背景が中くらいの濃さだと文字が読みにくいため、
// 文字とのコントラストが十分（7:1以上）になるまで、背景を白（または黒）に寄せて調整する。
const LABEL_DARK_TEXT = '#1f1409';
const LABEL_TARGET_CONTRAST = 7;
const toHex = channels => `#${channels.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
function mixHex(hex, other, amount) {
  const base = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return toHex(base.map((value, index) => value + (other[index] - value) * amount));
}
export function labelColors(background) {
  if (!COLOR_PATTERN.test(asText(background))) return { background: '', color: '' };
  const darkLuminance = luminance(LABEL_DARK_TEXT);
  const contrastWith = (hex, textIsWhite) => {
    const light = luminance(hex);
    return textIsWhite ? 1.05 / (light + 0.05) : (light + 0.05) / (darkLuminance + 0.05);
  };
  // 白と濃い茶色のうち、読みやすい方を文字色にする。
  const textIsWhite = contrastWith(background, true) > contrastWith(background, false);
  const target = textIsWhite ? [0, 0, 0] : [255, 255, 255];
  let adjusted = background.toLowerCase();
  for (let step = 1; step <= 7 && contrastWith(adjusted, textIsWhite) < LABEL_TARGET_CONTRAST; step++) {
    adjusted = mixHex(background, target, step * 0.1);
  }
  return { background: adjusted, color: textIsWhite ? '#ffffff' : LABEL_DARK_TEXT };
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
// 画像のURLに差し込む切り抜きの指定（自動トリミングも、手動のトリミングも同じ c_crop の形）。
const CROP_SEGMENT = /\/c_crop,[A-Za-z0-9_.,]+(?=\/v\d+\/)/;

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

// 切り抜き指定を外した元画像のURL。変換が使えない場合の表示用、トリミング画面の元画像にも使う。
export function originalImageUrl(value) {
  const text = asText(value);
  return text.replace(POSITION_HASH, '').replace(CROP_SEGMENT, '');
}

// 一覧のカードに表示する部分の位置。切り抜いた画像の中での位置を 0〜1 の割合で、URLの末尾（#pos=横,縦）に持つ。
// 末尾の # 以降はサーバーに送られず、画像の取得や保存先のルールには影響しない。
const POSITION_HASH = /#pos=([0-9.]+),([0-9.]+)$/;
export const CENTER_POSITION = Object.freeze({ x: 0.5, y: 0.5 });
export function parseThumbPosition(value) {
  const match = asText(value).match(POSITION_HASH);
  if (!match) return null;
  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
export function withThumbPosition(value, position) {
  const base = asText(value).replace(POSITION_HASH, '');
  if (!position || (Math.abs(position.x - 0.5) < 0.005 && Math.abs(position.y - 0.5) < 0.005)) return base;
  const f = number => Math.min(1, Math.max(0, Number(number) || 0)).toFixed(3);
  return `${base}#pos=${f(position.x)},${f(position.y)}`;
}

// 手動トリミング。範囲は元画像に対する割合（0〜1）で、x・y は左上、w・h は幅と高さ。
// 元の画像はCloudinaryに残り、切り抜き指定を外せばいつでも元に戻せる。
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
const MIN_CROP = 0.05;
const fraction = value => Math.min(1, Math.max(0, Number(value) || 0));
export function isFullCrop(rect) {
  return !!rect && [rect.x, rect.y].every(value => value < 0.001) && [rect.w, rect.h].every(value => value > 0.999);
}
// URLに入っている切り抜き範囲。入っていなければ null（画像全体）。
export function parseCropRect(value) {
  const match = asText(value).match(/\/c_crop,([A-Za-z0-9_.,]+)(?=\/v\d+\/)/);
  if (!match) return null;
  const rect = { ...FULL_CROP };
  for (const part of match[1].split(',')) {
    const [key, text] = part.split('_');
    const number = parseFloat(text);
    if (['x', 'y', 'w', 'h'].includes(key) && Number.isFinite(number)) rect[key] = number;
  }
  if (rect.x < 0 || rect.y < 0 || rect.w < MIN_CROP || rect.h < MIN_CROP || rect.x + rect.w > 1.001 || rect.y + rect.h > 1.001) return null;
  return rect;
}
// 元画像のURLに切り抜き範囲を差し込む。Cloudinaryの画像でなければ変えずに返す。
export function cropImageUrl(originalUrl, rect) {
  const src = safeImageUrl(originalImageUrl(originalUrl));
  if (!src || !rect || isFullCrop(rect)) return src || asText(originalUrl);
  const url = new URL(src);
  const match = url.pathname.match(/^(\/[^/]+\/image\/upload\/)(v\d+\/.+)$/);
  if (!match) return src;
  const w = Math.max(MIN_CROP, fraction(rect.w));
  const h = Math.max(MIN_CROP, fraction(rect.h));
  const x = Math.min(fraction(rect.x), 1 - w);
  const y = Math.min(fraction(rect.y), 1 - h);
  const f = number => number.toFixed(4);
  url.pathname = `${match[1]}c_crop,x_${f(x)},y_${f(y)},w_${f(w)},h_${f(h)}/${match[2]}`;
  return url.href;
}
// トリミングできる画像（Cloudinaryにある画像）かどうか。
export function canCropImage(value) {
  const src = safeImageUrl(originalImageUrl(value));
  return !!src && /^\/[^/]+\/image\/upload\/v\d+\/.+/.test(new URL(src).pathname);
}

// 文字認識の結果を、メモに入れやすい文章に整える。
// 日本語の認識結果は「材 料 米 粉」「1 個」のように余計な空白が入りやすく、行の間に空行が入ったり、
// 画面の飾りや記号だけの行が混ざったりする。
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef\\u3000-\\u303f';
const BETWEEN_CJK = new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g');
// 数字のあとの単位（「1 個」「170 度」）と、かっこの内側の空白
const AFTER_DIGIT = new RegExp(`([0-9])[ \\t]+(?=[${CJK}])`, 'g');
const INSIDE_PAREN = /([(（])[ \\t]+|[ \\t]+([)）])/g;
const WORD_CHAR = new RegExp(`[${CJK}A-Za-z0-9]`, 'g');
export function cleanOcrText(raw) {
  const kept = [];
  for (const line of asText(raw).replace(/\r\n?/g, '\n').split('\n')) {
    let text = line.replace(/[ \t]+/g, ' ').trim();
    // 空白を詰めたあとに新しい隣り合わせができても詰め切れるよう、変化がなくなるまで繰り返す。
    for (let previous = ''; previous !== text;) {
      previous = text;
      text = text.replace(BETWEEN_CJK, '$1').replace(AFTER_DIGIT, '$1').replace(INSIDE_PAREN, '$1$2');
    }
    // 記号や1文字だけの行は、画面の飾りなどの読み間違いとして捨てる。空行も詰める（行間が広いと空行が入るため）。
    if ((text.match(WORD_CHAR) || []).length >= 2) kept.push(text);
  }
  return kept.join('\n');
}

// ドラッグの動きから、新しい切り抜き範囲を求める。mode は 'move'（枠ごと動かす）か、
// 辺・角の名前（n・s・e・w・ne・nw・se・sw）。dx・dy は画像全体に対する割合での動き。
export function dragCropRect(rect, mode, dx, dy, min = MIN_CROP) {
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const next = { ...rect };
  if (mode === 'move') {
    next.x = clamp(rect.x + dx, 0, 1 - rect.w);
    next.y = clamp(rect.y + dy, 0, 1 - rect.h);
    return next;
  }
  if (mode.includes('w')) { const left = clamp(rect.x + dx, 0, rect.x + rect.w - min); next.x = left; next.w = rect.x + rect.w - left; }
  if (mode.includes('e')) next.w = clamp(rect.w + dx, min, 1 - rect.x);
  if (mode.includes('n')) { const top = clamp(rect.y + dy, 0, rect.y + rect.h - min); next.y = top; next.h = rect.y + rect.h - top; }
  if (mode.includes('s')) next.h = clamp(rect.h + dy, min, 1 - rect.y);
  return next;
}
