import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCategory, categoryLabel, normalizePostUrl, safePostUrl, safeImageUrl, normalizeRecipe, filterRecipes, validateImage, validateMemo, cropScreenshotUrl, originalImageUrl, DEFAULT_CATEGORIES, validateCategories, sanitizeCategories, newCategoryId, readableTextColor, nextPaletteColor, categoryColor } from '../src/core.mjs';

test('旧カテゴリを表示・編集・検索で共通の値へ変換する', () => {
  for (const [oldValue, newValue] of Object.entries({ dessert: 'snack', ai: 'it', bread: 'other', salad: 'other', drink: 'other' })) {
    assert.equal(normalizeCategory(oldValue), newValue);
    const recipe = normalizeRecipe('old', { category: oldValue });
    assert.equal(recipe.category, newValue);
    assert.equal(filterRecipes([recipe], newValue, categoryLabel(oldValue)).length, 1);
  }
  assert.equal(normalizeCategory('__proto__'), 'other');
  assert.equal(normalizeCategory(''), '');
});

test('実行可能URL・認証情報入りURLを拒否し、通常URLは保つ', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:password@example.com', 'not a url']) {
    assert.equal(safePostUrl(url), '');
    assert.throws(() => normalizePostUrl(url));
  }
  assert.equal(normalizePostUrl('https://example.com/recipe?id=123#steps'), 'https://example.com/recipe?id=123#steps');
  assert.equal(normalizePostUrl('https://www.instagram.com/p/test/?igsh=tracking&utm_source=test'), 'https://www.instagram.com/p/test/');
  assert.equal(safePostUrl(null), '');
});

test('画像はCloudinary HTTPSまたは同一オリジンのみ許可', () => {
  assert.equal(safeImageUrl('https://res.cloudinary.com/demo/image/upload/a.jpg'), 'https://res.cloudinary.com/demo/image/upload/a.jpg');
  for (const src of ['https://res.cloudinary.com.evil.invalid/image.jpg', 'http://res.cloudinary.com/a.jpg', 'javascript:alert(1)', 'https://user:password@res.cloudinary.com/a', null]) assert.equal(safeImageUrl(src), '');
  assert.equal(safeImageUrl('http://127.0.0.1:4173/test.jpg', 'http://127.0.0.1:4173'), 'http://127.0.0.1:4173/test.jpg');
  assert.equal(safeImageUrl('http://127.0.0.1:4173/test.jpg', 'https://example.com'), '');
});

test('不正な型でも検索・メモ表示を停止させず、DB内のidで文書IDを上書きしない', () => {
  const recipe = normalizeRecipe('real-document-id', { id: 'spoofed', memo: 123, post_url: null, category: {}, favorite: 'false' });
  assert.equal(recipe.id, 'real-document-id');
  assert.equal(recipe.memo, '');
  assert.equal(recipe.favorite, false);
  assert.doesNotThrow(() => filterRecipes([recipe], '', 'メモ'));
});

test('画像の形式・容量、メモの上限を検証する', () => {
  assert.throws(() => validateImage({ type: 'image/svg+xml', size: 100 }));
  assert.throws(() => validateImage({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }));
  assert.ok(validateImage({ type: 'image/png', size: 100 }));
  assert.throws(() => validateMemo('あ'.repeat(10001)));
  assert.equal(validateMemo(' <b>本文</b> '), '<b>本文</b>');
});

test('縦長のスクショだけ上下の余白を切り、元のURLへ戻せる', () => {
  const plain = 'https://res.cloudinary.com/demo/image/upload/v123/shot.png';
  const cropped = cropScreenshotUrl(plain, 1080, 2400);
  assert.equal(cropped, 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v123/shot.png');
  assert.equal(originalImageUrl(cropped), plain);
  // 横長・正方形に近い写真は切らない。
  assert.equal(cropScreenshotUrl(plain, 2400, 1080), plain);
  assert.equal(cropScreenshotUrl(plain, 1000, 1200), plain);
  // 寸法が不明・変換済み・Cloudinary以外はそのまま。
  assert.equal(cropScreenshotUrl(plain, undefined, undefined), plain);
  assert.equal(cropScreenshotUrl(cropped, 1080, 2400), cropped);
  assert.equal(cropScreenshotUrl('https://example.com/a.png', 1080, 2400), 'https://example.com/a.png');
  assert.equal(originalImageUrl(plain), plain);
});

test('設定したカテゴリで投稿を分類し、一覧にないカテゴリは「その他」（なければ未分類）にする', () => {
  const custom = [{ value: 'curry', label: 'カレー' }, { value: 'other', label: 'その他' }];
  assert.equal(normalizeCategory('curry', custom), 'curry');
  assert.equal(normalizeCategory('main', custom), 'other');
  assert.equal(normalizeCategory('dessert', custom), 'other');
  assert.equal(normalizeCategory('main', [{ value: 'curry', label: 'カレー' }]), '');
  assert.equal(categoryLabel('curry', custom), 'カレー');
  assert.equal(categoryLabel('main', custom), 'その他');
  const recipe = normalizeRecipe('x', { category: 'curry' }, custom);
  assert.equal(filterRecipes([recipe], 'curry', 'カレー', custom).length, 1);
  assert.equal(normalizeCategory('snack'), 'snack');
  assert.equal(DEFAULT_CATEGORIES.length, 8);
});

test('カテゴリ一覧の検証：件数・名前・識別子・重複', () => {
  assert.deepEqual(validateCategories([{ value: 'a', label: ' カレー ' }]), [{ value: 'a', label: 'カレー', color: '#f5a3a3' }]);
  for (const bad of [null, [], [{ value: 'a', label: '' }], [{ value: 'A!', label: 'x' }], [{ value: 'a', label: 'x'.repeat(21) }],
    [{ value: 'a', label: 'x', color: 'red' }], [{ value: 'a', label: 'x', color: '#12345' }],
    [{ value: 'a', label: 'x' }, { value: 'a', label: 'y' }], [{ value: 'a', label: 'x' }, { value: 'b', label: 'x' }],
    Array.from({ length: 31 }, (_, i) => ({ value: `c${i}`, label: `名${i}` }))]) assert.throws(() => validateCategories(bad));
  assert.equal(sanitizeCategories({ items: [{ value: 'a', label: 'x' }] }).length, 1);
  assert.equal(sanitizeCategories({ items: 'broken' }), null);
  assert.equal(sanitizeCategories(null), null);
});

test('新しいカテゴリの識別子は既存と重ならない', () => {
  const id = newCategoryId([{ value: 'snack' }], () => 1_700_000_000_000, () => 0.5);
  assert.match(id, /^c[a-z0-9]+$/);
  assert.ok(id.length <= 24);
  const same = newCategoryId([{ value: id }], () => 1_700_000_000_000, () => 0.5);
  assert.notEqual(same, id);
});

test('カテゴリの色：色がなければ自動で付け、重ならない。色の指定は正規化する', () => {
  const colored = validateCategories([{ value: 'a', label: 'カレー' }, { value: 'snack', label: 'おやつ' }, { value: 'b', label: 'x', color: '#ABCDEF' }, { value: 'c', label: 'y' }]);
  assert.equal(colored[1].color, DEFAULT_CATEGORIES.find(item => item.value === 'snack').color);
  assert.equal(colored[2].color, '#abcdef');
  assert.equal(new Set(colored.map(item => item.color)).size, 4);
  assert.ok(DEFAULT_CATEGORIES.every(item => /^#[0-9a-f]{6}$/.test(item.color)));
  assert.equal(new Set(DEFAULT_CATEGORIES.map(item => item.color)).size, DEFAULT_CATEGORIES.length);
});

test('文字色は背景の明るさから決まり、初期の色はすべて読みやすい', () => {
  assert.equal(readableTextColor('#ffffff'), '#3a2a1a');
  assert.equal(readableTextColor('#2b2b2b'), '#ffffff');
  assert.equal(readableTextColor('#8c3a1a'), '#ffffff');
  assert.equal(readableTextColor('bad'), '#3a2a1a');
  const contrast = (a, b) => {
    const light = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const item of DEFAULT_CATEGORIES) assert.ok(contrast(item.color, readableTextColor(item.color)) >= 4.5, item.label);
  // どんな背景色でも、白と濃い茶色の2択の中で読みやすい方を選ぶ（中間のグレーや純粋な赤は4前後が上限）。
  for (const hex of ['#000000', '#777777', '#ff0000', '#00ff00', '#0000ff', '#ffff00']) assert.ok(contrast(hex, readableTextColor(hex)) >= 3.9, hex);
});

test('カテゴリの色の取り出しと、次のパレットの色', () => {
  assert.equal(categoryColor('main'), '#f4b860');
  assert.equal(categoryColor('curry', [{ value: 'curry', label: 'カレー', color: '#ABCDEF' }]), '#abcdef');
  assert.equal(categoryColor('', DEFAULT_CATEGORIES), '');
  assert.equal(categoryColor('x', [{ value: 'x', label: 'x' }]), '');
  assert.equal(nextPaletteColor(['#f5a3a3', '#f4b860']), '#9fd3a0');
  assert.equal(nextPaletteColor([]), '#f5a3a3');
});
