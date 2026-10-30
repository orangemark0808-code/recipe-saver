import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.mjs';
import { normalizeRecipe } from '../src/core.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const makeRecipe = (id, category = 'main') => normalizeRecipe(id, { memo: `${id}のメモ`, category, post_url: 'https://www.instagram.com/p/example/', favorite: false });

function harness(overrides = {}) {
  let authCallback;
  const calls = { list: 0, create: [], update: [], remove: [], upload: 0, categories: [], categoriesData: null, ocr: [], ocrText: '材 料 ： 米 粉\n|\n作 り 方' };
  const screen = { notices: [], lists: [], closed: 0, cleared: 0, newInput: { url: 'https://www.instagram.com/p/example/', memo: '新しいメモ', category: 'snack', file: null }, editInput: { url: 'https://www.instagram.com/p/example/', memo: '更新メモ', category: 'main', file: null }, categoryRows: [], allowRemoval: true };
  const backend = {
    watchAuth(callback) { authCallback = callback; return () => {}; },
    async login() {}, async logout() { authCallback(null); },
    async list() { calls.list++; return [makeRecipe('A'), makeRecipe('B', 'side')]; },
    async create(data) { calls.create.push(data); return 'C'; },
    async update(id, data) { calls.update.push({ id, data }); },
    async remove(id) { calls.remove.push(id); },
    async loadCategories() { return calls.categoriesData; },
    async saveCategories(items) { calls.categories.push(items); },
    async upload() { calls.upload++; return 'https://res.cloudinary.com/demo/image/upload/new.jpg'; },
    ...overrides
  };
  const view = {
    bind() {}, reset() { screen.closed++; }, destroy() {},
    setAuth(kind) { screen.auth = kind; },
    setBusy(state) { screen.busy = { ...state }; },
    renderList(data) { screen.lists.push(data); screen.list = data; },
    notify(message, error) { screen.notices.push({ message, error }); },
    clearNew() { screen.cleared++; screen.newInput = { url: '', memo: '', category: '', file: null }; }, clearFilters() {},
    openDetail(recipe) { screen.detail = recipe; }, renderDetail(recipe) { screen.detail = recipe; }, closeDetail() { screen.detail = null; },
    openEdit(recipe) { screen.edit = recipe; screen.editInput = { url: recipe.post_url, memo: recipe.memo, category: recipe.category, file: null }; },
    closeEdit() { screen.closed++; screen.edit = null; },
    setCategories(list) { screen.categories = list; },
    openCategories(list) { screen.categoryOpen = list; screen.categoryRows = list.map(item => ({ ...item })); },
    closeCategories() { screen.categoryClosed = (screen.categoryClosed || 0) + 1; },
    readCategories() { return screen.categoryRows; },
    categoriesChanged() { return !!screen.categoriesChanged; },
    confirmCategoryRemoval(info) { screen.removalAsked = info; return screen.allowRemoval; },
    openCrop(info) { screen.crop = info; }, closeCrop() { screen.cropClosed = (screen.cropClosed || 0) + 1; },
    setEditThumbnail(url) { screen.editThumbnail = url; },
    setOcr(which, info) { (screen.ocrStates ??= []).push({ which, ...info }); },
    insertMemoText(which, text) { screen.inserted = { which, text }; },
    confirmDelete() { return true; },
    confirmDiscard() { screen.discardAsked = (screen.discardAsked || 0) + 1; return screen.allowDiscard ?? true; },
    applyShared(shared) { screen.shared = shared; },
    readNew() { return screen.newInput; }, readEdit() { return screen.editInput; }
  };
  const ocr = overrides.ocr ?? {
    async recognize(source, onProgress) { calls.ocr.push(source); onProgress({ stage: 'prepare', progress: 0.2 }); onProgress({ stage: 'read', progress: 0.5 }); return calls.ocrText; }
  };
  delete overrides.ocr;
  const controller = createController({ backend, view, ownerUid: 'owner', ocr, now: () => new Date('2026-10-28T00:00:00Z') });
  controller.start();
  return { controller, backend, calls, screen, async auth(uid) { authCallback(uid ? { uid } : null); await tick(); }, async ready() { await this.auth('owner'); } };
}

test('未ログイン・別アカウントでは読み込みも保存もしない', async () => {
  const t = harness();
  await t.auth(null);
  await t.controller.saveNew();
  await t.auth('someone-else');
  await t.controller.saveNew();
  assert.equal(t.calls.list, 0);
  assert.equal(t.calls.create.length, 0);
  assert.equal(t.screen.auth, 'denied');
});

test('保存連打を1回にまとめ、成功後も全件を再取得しない', async () => {
  const pending = deferred();
  const t = harness();
  t.backend.create = async data => { t.calls.create.push(data); await pending.promise; return 'C'; };
  await t.ready();
  const first = t.controller.saveNew();
  const second = t.controller.saveNew();
  assert.equal(t.screen.busy.savingNew, true);
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(t.calls.create.length, 1);
  assert.equal(t.screen.list.total, 3);
  assert.equal(t.screen.cleared, 1);
  assert.equal(t.calls.list, 1);
});

test('保存失敗時は入力を残し、保存ボタンを再び使える', async () => {
  const t = harness({ async create() { throw new Error('テスト通信エラー'); } });
  await t.ready();
  await t.controller.saveNew();
  assert.equal(t.screen.cleared, 0);
  assert.equal(t.screen.busy.savingNew, false);
  assert.equal(t.screen.list.total, 2);
  assert.ok(t.screen.notices.at(-1).error);
});

test('アップロード待機中は閉じる・別投稿を開く・二重保存を防ぎ、Aだけ更新', async () => {
  const upload = deferred();
  const t = harness({ upload: () => upload.promise });
  await t.ready();
  t.controller.openEdit('A');
  t.screen.editInput.memo = 'Aだけの更新';
  t.screen.editInput.file = { type: 'image/png', size: 10 };
  const save = t.controller.saveEdit();
  t.controller.closeEdit();
  t.controller.openEdit('B');
  await t.controller.saveEdit();
  assert.equal(t.screen.edit.id, 'A');
  upload.resolve('https://res.cloudinary.com/demo/image/upload/new.jpg');
  await save;
  assert.deepEqual(t.calls.update.map(call => call.id), ['A']);
  assert.equal(t.calls.update[0].data.memo, 'Aだけの更新');
  assert.equal(t.screen.list.recipes.find(recipe => recipe.id === 'B').memo, 'Bのメモ');
  assert.equal(t.screen.edit, null);
});

test('未選択の編集保存はnull IDをDBへ渡さない', async () => {
  const t = harness();
  await t.ready();
  await t.controller.saveEdit();
  assert.equal(t.calls.update.length, 0);
  assert.match(t.screen.notices.at(-1).message, /選んで/);
});

test('画像アップロード中に認証が失われたら更新も新規保存も止める', async () => {
  for (const editing of [true, false]) {
    const upload = deferred();
    const t = harness({ upload: () => upload.promise });
    await t.ready();
    if (editing) t.controller.openEdit('A');
    (editing ? t.screen.editInput : t.screen.newInput).file = { type: 'image/png', size: 10 };
    const saving = editing ? t.controller.saveEdit() : t.controller.saveNew();
    await t.auth(null);
    upload.resolve('https://res.cloudinary.com/demo/image/upload/new.jpg');
    await saving;
    assert.equal(t.calls.update.length, 0);
    assert.equal(t.calls.create.length, 0);
    assert.equal(t.screen.list.total, 0);
  }
});

test('ログアウト後に古い読込結果が戻っても投稿を表示しない', async () => {
  const read = deferred();
  const t = harness({ list: () => read.promise });
  await t.auth('owner');
  await t.auth(null);
  read.resolve([makeRecipe('private')]);
  await tick();
  assert.equal(t.screen.auth, 'signed-out');
  assert.equal(t.screen.list.total, 0);
});

test('検索・カテゴリ連続変更で再通信せず、最後の条件が必ず反映される', async () => {
  const t = harness();
  await t.ready();
  t.controller.search('A');
  t.controller.search('B');
  t.controller.filter('main');
  t.controller.filter('side');
  assert.equal(t.calls.list, 1);
  assert.deepEqual(t.screen.list.recipes.map(recipe => recipe.id), ['B']);
  t.controller.clearFilters();
  assert.equal(t.screen.list.recipes.length, 2);
});

test('読込中の条件変更は最新条件を使い、古い再読込結果は無視する', async () => {
  const first = deferred(), second = deferred();
  let reads = 0;
  const t = harness({ list: () => ++reads === 1 ? first.promise : second.promise });
  await t.auth('owner');
  const reload = t.controller.reload();
  t.controller.filter('side');
  second.resolve([makeRecipe('B', 'side')]);
  await reload;
  first.resolve([makeRecipe('A', 'main')]);
  await tick();
  assert.deepEqual(t.screen.list.recipes.map(recipe => recipe.id), ['B']);
});

test('お気に入り連打を防ぎ、失敗時は元の状態を保持する', async () => {
  const write = deferred();
  const t = harness();
  t.backend.update = async (id, data) => { t.calls.update.push({ id, data }); await write.promise; };
  await t.ready();
  const first = t.controller.toggleFavorite('A');
  const second = t.controller.toggleFavorite('A');
  write.reject(new Error('失敗'));
  await Promise.all([first, second]);
  assert.equal(t.calls.update.length, 1);
  assert.equal(t.screen.list.recipes.find(recipe => recipe.id === 'A').favorite, false);
  assert.equal(t.screen.busy.actionsBusy, false);
});

test('旧カテゴリを編集保存しても分類が消えない', async () => {
  const t = harness({ list: async () => [{ id: 'old', memo: '旧投稿', category: 'dessert' }] });
  await t.ready();
  t.controller.openEdit('old');
  assert.equal(t.screen.editInput.category, 'snack');
  t.screen.editInput.memo = 'メモだけ変更';
  await t.controller.saveEdit();
  assert.equal(t.calls.update[0].data.category, 'snack');
});

test('読み込み失敗を0件と混同せず、再試行で回復する', async () => {
  const t = harness({ list: async () => { throw new Error('offline'); } });
  await t.ready();
  assert.match(t.screen.list.error, /読み込めません/);
  assert.equal(t.screen.busy.loaded, false);
  t.backend.list = async () => [makeRecipe('A')];
  await t.controller.reload();
  assert.equal(t.screen.list.error, '');
  assert.equal(t.screen.list.total, 1);
});

test('削除成功時だけキャッシュから除去し、一覧を再取得しない', async () => {
  const t = harness();
  await t.ready();
  await t.controller.deleteRecipe('A');
  assert.deepEqual(t.calls.remove, ['A']);
  assert.deepEqual(t.screen.list.recipes.map(recipe => recipe.id), ['B']);
  assert.equal(t.calls.list, 1);
});

test('詳細の閲覧は書き込まず、編集保存後に詳細へ更新内容を反映する', async () => {
  const t = harness(); await t.ready();
  t.controller.openDetail('A');
  assert.equal(t.screen.detail.id, 'A');
  assert.equal(t.calls.update.length, 0);
  t.controller.openEdit('A');
  t.screen.editInput.memo = '材料と手順の全文';
  await t.controller.saveEdit();
  assert.equal(t.screen.detail.memo, '材料と手順の全文');
  assert.equal(t.screen.discardAsked || 0, 0);
  t.controller.closeDetail();
  assert.equal(t.screen.detail, null);
});

test('未変更の編集を閉じるときは確認せず、変更をキャンセルすると入力を保持する', async () => {
  const t = harness(); await t.ready();
  t.controller.openEdit('A'); t.controller.closeEdit();
  assert.equal(t.screen.discardAsked || 0, 0);
  t.controller.openEdit('A');
  t.screen.editInput.memo = '消したくない手順'; t.screen.allowDiscard = false;
  t.controller.closeEdit({ type: 'click' });
  assert.equal(t.screen.edit.id, 'A');
  assert.equal(t.screen.editInput.memo, '消したくない手順');
  t.controller.openEdit('B');
  assert.equal(t.screen.edit.id, 'A');
  t.screen.allowDiscard = true; t.controller.closeEdit();
  assert.equal(t.screen.edit, null);
});

test('カテゴリ変更と画像の差し替えも未保存として扱い、元に戻すと未変更になる', async () => {
  const t = harness(); await t.ready();
  t.screen.newInput = { url: '', memo: '', category: '', file: null };
  t.controller.openEdit('A');
  assert.equal(t.controller.hasUnsavedChanges(), false);
  t.screen.editInput.category = 'side';
  assert.equal(t.controller.hasUnsavedChanges(), true);
  t.screen.editInput.category = 'main';
  assert.equal(t.controller.hasUnsavedChanges(), false);
  t.screen.editInput.file = { type: 'image/png', size: 10 };
  assert.equal(t.controller.hasUnsavedChanges(), true);
});

test('新規入力のクリア・ログアウトを取り消せて、承認したクリアのみ実行する', async () => {
  const t = harness(); await t.ready();
  t.screen.allowDiscard = false;
  t.controller.clearNew(); await t.controller.logout();
  assert.equal(t.screen.cleared, 0);
  assert.equal(t.screen.auth, 'owner');
  assert.equal(t.controller.hasUnsavedChanges(), true);
  t.screen.allowDiscard = true; t.controller.clearNew();
  assert.equal(t.screen.cleared, 1);
  assert.equal(t.controller.hasUnsavedChanges(), false);
});

test('編集保存が失敗しても変更と破棄確認を保持する', async () => {
  const t = harness({ update: async () => { throw new Error('offline'); } }); await t.ready();
  t.controller.openEdit('A'); t.screen.editInput.memo = '保持する';
  await t.controller.saveEdit();
  t.screen.allowDiscard = false; t.controller.closeEdit();
  assert.equal(t.screen.editInput.memo, '保持する');
  assert.equal(t.screen.edit.id, 'A');
  assert.equal(t.screen.discardAsked, 1);
});

test('共有された内容は、本人のログインと読み込みのあとでフォームに入る', async () => {
  const t = harness();
  const shared = { url: 'https://www.instagram.com/p/shared/', file: null };
  t.controller.setShared(shared);
  await t.auth(null);
  assert.equal(t.screen.shared, undefined);
  await t.auth('owner');
  assert.equal(t.screen.shared, shared);
  assert.equal(t.calls.list, 1);
  assert.match(t.screen.notices.at(-1).message, /共有された内容/);
});

test('別アカウントでは共有された内容を入力せず、破棄する', async () => {
  const t = harness();
  t.controller.setShared({ url: 'https://www.instagram.com/p/shared/', file: null });
  await t.auth('someone-else');
  await t.auth('owner');
  assert.equal(t.screen.shared, undefined);
  t.controller.setShared({ url: '', file: null });
  await t.auth('owner');
  assert.equal(t.screen.shared, undefined);
});

test('メモとカテゴリだけの下書きも、本人のログイン後にフォームへ戻す', async () => {
  const t = harness();
  const shared = { url: '', memo: '米粉のクッキー', category: 'snack', file: null };
  t.controller.setShared(shared);
  await t.auth('owner');
  assert.equal(t.screen.shared, shared);
}); 

test('編集でURLを変えると保存され、変えなければURLは更新しない', async () => {
  const t = harness();
  await t.ready();
  t.controller.openEdit('A');
  t.screen.editInput.url = 'https://www.instagram.com/p/changed/?igsh=tracking';
  await t.controller.saveEdit();
  assert.equal(t.calls.update[0].data.post_url, 'https://www.instagram.com/p/changed/');
  assert.equal(t.screen.list.recipes.find(item => item.id === 'A').post_url, 'https://www.instagram.com/p/changed/');
  t.controller.openEdit('B');
  t.screen.editInput.memo = 'メモだけ変更';
  await t.controller.saveEdit();
  assert.equal(Object.hasOwn(t.calls.update[1].data, 'post_url'), false);
});

test('編集で不正なURLや、URLも画像もない状態は保存しない。触っていない古いURLは弾かない', async () => {
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'a', post_url: 'javascript:alert(1)' })]; } });
  await t.ready();
  t.controller.openEdit('A');
  t.screen.editInput.memo = '古いURLのまま更新';
  await t.controller.saveEdit();
  assert.equal(t.calls.update.length, 1);
  assert.equal(Object.hasOwn(t.calls.update[0].data, 'post_url'), false);
  t.controller.openEdit('A');
  t.screen.editInput.url = 'not a url';
  await t.controller.saveEdit();
  assert.equal(t.calls.update.length, 1);
  assert.equal(t.screen.notices.at(-1).error, true);
  t.screen.editInput.url = '';
  await t.controller.saveEdit();
  assert.equal(t.calls.update.length, 1);
  assert.match(t.screen.notices.at(-1).message, /投稿URLまたは画像/);
});

test('保存先のカテゴリ設定を読み込み、投稿と選択欄に使う。読めなければ初期カテゴリ', async () => {
  const custom = { items: [{ value: 'curry', label: 'カレー' }, { value: 'other', label: 'その他' }] };
  const t = harness({ async list() { return [normalizeRecipe('A', { category: 'curry' }, custom.items), normalizeRecipe('B', { category: 'main' })]; } });
  t.calls.categoriesData = custom;
  await t.ready();
  assert.deepEqual(t.screen.categories.map(item => item.value), ['curry', 'other']);
  assert.equal(t.screen.list.recipes.find(item => item.id === 'A').category, 'curry');
  assert.equal(t.screen.list.recipes.find(item => item.id === 'B').category, 'other');
  const broken = harness({ async loadCategories() { throw new Error('permission-denied'); } });
  await broken.ready();
  assert.equal(broken.screen.categories.length, 8);
  assert.equal(broken.screen.list.recipes.length, 2);
});

test('カテゴリを追加・名前変更・並べ替えて保存する。新しい行にだけ識別子が付く', async () => {
  const t = harness();
  await t.ready();
  t.controller.openCategories();
  const rows = t.screen.categoryRows;
  t.screen.categoryRows = [{ value: '', label: 'カレー' }, ...rows.slice(0, 2).reverse().map(row => row.value === 'main' ? { ...row, label: 'メインおかず' } : row), ...rows.slice(2)];
  await t.controller.saveCategories();
  const saved = t.calls.categories[0];
  assert.equal(saved[0].label, 'カレー');
  assert.match(saved[0].color, /^#[0-9a-f]{6}$/);
  assert.match(saved[0].value, /^c[a-z0-9]+$/);
  assert.deepEqual(saved.slice(1, 3).map(item => item.value), ['main', 'snack']);
  assert.equal(saved[1].label, 'メインおかず');
  assert.deepEqual(t.screen.categories, saved);
  assert.equal(t.screen.categoryClosed, 1);
  assert.match(t.screen.notices.at(-1).message, /カテゴリを保存/);
});

test('カテゴリの削除は確認し、その投稿は「その他」になる。やめれば何も変えない', async () => {
  const t = harness();
  await t.ready();
  t.controller.openCategories();
  t.screen.categoryRows = t.screen.categoryRows.filter(row => row.value !== 'side');
  t.screen.allowRemoval = false;
  await t.controller.saveCategories();
  assert.deepEqual(t.screen.removalAsked, { names: ['副菜'], posts: 1 });
  assert.equal(t.calls.categories.length, 0);
  t.screen.allowRemoval = true;
  await t.controller.saveCategories();
  assert.equal(t.calls.categories.length, 1);
  assert.equal(t.screen.list.recipes.find(item => item.id === 'B').category, 'other');
});

test('カテゴリが重複・空・保存失敗のときは保存せず理由を出し、画面は閉じない', async () => {
  const t = harness();
  await t.ready();
  t.controller.openCategories();
  t.screen.categoryRows = t.screen.categoryRows.map(row => row.value === 'main' ? { ...row, label: 'おやつ' } : row);
  await t.controller.saveCategories();
  assert.match(t.screen.notices.at(-1).message, /重複/);
  t.screen.categoryRows = t.screen.categoryRows.map(row => row.value === 'main' ? { ...row, label: '  ' } : row);
  await t.controller.saveCategories();
  assert.match(t.screen.notices.at(-1).message, /カテゴリ名を入力/);
  assert.equal(t.calls.categories.length, 0);
  const failing = harness({ async saveCategories() { throw new Error('カテゴリを保存できませんでした。'); } });
  await failing.ready();
  failing.controller.openCategories();
  await failing.controller.saveCategories();
  assert.equal(failing.screen.notices.at(-1).error, true);
  assert.equal(failing.screen.categoryClosed, undefined);
  assert.equal(failing.screen.categories.length, 8);
});

test('新規投稿：画像から読み取った文字を整えてメモに入れる。画像がなければ読み取らない', async () => {
  const t = harness();
  await t.ready();
  await t.controller.readText('new');
  assert.match(t.screen.notices.at(-1).message, /先に画像/);
  assert.equal(t.calls.ocr.length, 0);
  const file = { type: 'image/png', size: 10 };
  t.screen.newInput.file = file;
  await t.controller.readText('new');
  assert.equal(t.calls.ocr[0], file);
  assert.deepEqual(t.screen.inserted, { which: 'new', text: '材料：米粉\n作り方' });
  assert.match(t.screen.notices.at(-1).message, /読み取った文字/);
  assert.equal(t.screen.ocrStates.at(-1).busy, false);
  assert.ok(t.screen.ocrStates.some(state => state.busy && /読み取っています/.test(state.message)));
});

test('読み取り中の二重実行を防ぎ、結果が空・失敗のときは入れずに理由を出す', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const t = harness({ ocr: { async recognize() { await gate; return '|'; } } });
  await t.ready();
  t.screen.newInput.file = { type: 'image/png', size: 10 };
  const first = t.controller.readText('new');
  await t.controller.readText('new');
  release();
  await first;
  assert.equal(t.screen.inserted, undefined);
  assert.match(t.screen.notices.at(-1).message, /読み取れませんでした/);
  const failing = harness({ ocr: { async recognize() { throw new Error('文字認識の部品を読み込めませんでした。'); } } });
  await failing.ready();
  failing.screen.newInput.file = { type: 'image/png', size: 10 };
  await failing.controller.readText('new');
  assert.equal(failing.screen.notices.at(-1).error, true);
  assert.equal(failing.screen.ocrStates.at(-1).busy, false);
});

test('編集：新しく選んだ画像を優先し、なければ保存済みの元の画像を読み取る', async () => {
  const cropped = 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v1/shot.png';
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'a', post_url: 'https://www.instagram.com/p/a/', thumbnail_url: cropped })]; } });
  await t.ready();
  t.controller.openEdit('A');
  await t.controller.readText('edit');
  assert.equal(t.calls.ocr[0], 'https://res.cloudinary.com/demo/image/upload/v1/shot.png');
  assert.equal(t.screen.inserted.which, 'edit');
  const file = { type: 'image/png', size: 10 };
  t.screen.editInput.file = file;
  await t.controller.readText('edit');
  assert.equal(t.calls.ocr[1], file);
});

test('読み取り中にログアウトしたり画像を変えたら、結果はメモに入れない', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const t = harness({ ocr: { async recognize() { await gate; return '材料 米粉'; } } });
  await t.ready();
  t.screen.newInput.file = { type: 'image/png', size: 10 };
  const run = t.controller.readText('new');
  t.screen.newInput.file = { type: 'image/png', size: 20 };
  release();
  await run;
  assert.equal(t.screen.inserted, undefined);
  let release2;
  const gate2 = new Promise(resolve => { release2 = resolve; });
  const u = harness({ ocr: { async recognize() { await gate2; return '材料 米粉'; } } });
  await u.ready();
  u.screen.newInput.file = { type: 'image/png', size: 10 };
  const run2 = u.controller.readText('new');
  await u.auth(null);
  release2();
  await run2;
  assert.equal(u.screen.inserted, undefined);
});

test('編集：別のスクショを選んで文字だけ読み取る。カバー画像は変えず、画像は保存しない', async () => {
  const cover = 'https://res.cloudinary.com/demo/image/upload/v1/cover.png';
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'もとのメモ', post_url: 'https://www.instagram.com/p/a/', thumbnail_url: cover })]; } });
  await t.ready();
  t.controller.openEdit('A');
  const screenshot = { type: 'image/png', size: 10 };
  await t.controller.readText('edit', screenshot);
  assert.equal(t.calls.ocr[0], screenshot);
  assert.deepEqual(t.screen.inserted, { which: 'edit', text: '材料：米粉\n作り方' });
  assert.equal(t.calls.upload, 0);
  assert.equal(t.calls.update.length, 0);
  assert.equal(t.screen.editInput.file, null);
  // 画像の種類が違うファイルは読み取らず、理由を出す。
  await t.controller.readText('edit', { type: 'application/pdf', size: 10 });
  assert.equal(t.calls.ocr.length, 1);
  assert.equal(t.screen.notices.at(-1).error, true);
});

test('トリミング：範囲を決めて適用し、編集の「保存」で切り抜き指定つきのURLに差し替える。画像は上げ直さない', async () => {
  const original = 'https://res.cloudinary.com/demo/image/upload/v1/cover.png';
  const auto = 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v1/cover.png';
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'a', post_url: 'https://www.instagram.com/p/a/', thumbnail_url: auto })]; } });
  await t.ready();
  t.controller.openEdit('A');
  t.controller.openCrop();
  // 元の画像を表示し、今の切り抜き（自動トリミング）を初期の範囲にする。
  assert.equal(t.screen.crop.url, original);
  assert.deepEqual(t.screen.crop.rect, { x: 0, y: 0.08, w: 1, h: 0.84 });
  t.controller.applyCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  const cropped = 'https://res.cloudinary.com/demo/image/upload/c_crop,x_0.1000,y_0.2000,w_0.5000,h_0.4000/v1/cover.png';
  assert.equal(t.screen.editThumbnail, cropped);
  assert.equal(t.screen.cropClosed, 1);
  assert.equal(t.calls.update.length, 0);
  await t.controller.saveEdit();
  assert.equal(t.calls.update[0].data.thumbnail_url, cropped);
  assert.equal(t.calls.upload, 0);
  assert.equal(t.screen.list.recipes.find(item => item.id === 'A').thumbnail_url, cropped);
});

test('トリミング：全体に戻すと元の画像のURLになる。変えていなければ画像は更新しない。画像がなければ開かない', async () => {
  const original = 'https://res.cloudinary.com/demo/image/upload/v1/cover.png';
  const auto = 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v1/cover.png';
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'a', post_url: 'https://www.instagram.com/p/a/', thumbnail_url: auto }), normalizeRecipe('B', { memo: 'b', post_url: 'https://www.instagram.com/p/b/' })]; } });
  await t.ready();
  t.controller.openEdit('A');
  t.controller.openCrop();
  t.controller.applyCrop({ x: 0, y: 0, w: 1, h: 1 });
  assert.equal(t.screen.editThumbnail, original);
  await t.controller.saveEdit();
  assert.equal(t.calls.update[0].data.thumbnail_url, original);
  // トリミングを開いただけ・メモだけ変更なら、画像のURLは更新しない。
  t.controller.openEdit('A');
  t.controller.openCrop();
  t.screen.editInput.memo = 'メモだけ';
  await t.controller.saveEdit();
  assert.equal(Object.hasOwn(t.calls.update[1].data, 'thumbnail_url'), false);
  // 画像のない投稿ではトリミングを開かない。
  t.screen.crop = undefined;
  t.controller.openEdit('B');
  t.controller.openCrop();
  assert.equal(t.screen.crop, undefined);
  assert.equal(t.screen.notices.at(-1).error, true);
});

test('一覧の表示位置：トリミング画面で決めた位置を、画像のURLの末尾に付けて保存し、開き直すと復元する', async () => {
  const original = 'https://res.cloudinary.com/demo/image/upload/v1/cover.png';
  const t = harness({ async list() { return [normalizeRecipe('A', { memo: 'a', post_url: 'https://www.instagram.com/p/a/', thumbnail_url: original })]; } });
  await t.ready();
  t.controller.openEdit('A');
  t.controller.openCrop();
  assert.deepEqual(t.screen.crop.focus, { x: 0.5, y: 0.5 });
  // 範囲は変えず、表示位置だけ変える。
  t.controller.applyCrop({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0.2 });
  assert.equal(t.screen.editThumbnail, original + '#pos=0.500,0.200');
  await t.controller.saveEdit();
  assert.equal(t.calls.update[0].data.thumbnail_url, original + '#pos=0.500,0.200');
  assert.equal(t.calls.upload, 0);
  // 開き直すと、保存した位置から始まる。切り抜きと位置を一緒に変えても、1つのURLにまとまる。
  t.controller.openEdit('A');
  t.controller.openCrop();
  assert.deepEqual(t.screen.crop.focus, { x: 0.5, y: 0.2 });
  assert.equal(t.screen.crop.url, original);
  t.controller.applyCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, { x: 0.3, y: 0.5 });
  assert.equal(t.screen.editThumbnail, 'https://res.cloudinary.com/demo/image/upload/c_crop,x_0.1000,y_0.2000,w_0.5000,h_0.4000/v1/cover.png#pos=0.300,0.500');
  // 位置を中央に戻せば目印は付かない。
  t.controller.applyCrop({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0.5 });
  assert.equal(t.screen.editThumbnail, original);
});

test('新規投稿：文字読み取り用の画像を上から順にすべて読み取り、空行で区切ってメモに入れる。保存はカバーだけ', async () => {
  const texts = ['材 料 ： 米 粉', '作 り 方'];
  const t = harness({ ocr: { async recognize(source, onProgress) { t.calls.ocr.push(source); onProgress({ stage: 'read', progress: 0.5 }); return texts.shift(); } } });
  await t.ready();
  const cover = { type: 'image/png', size: 10 };
  const shots = [{ type: 'image/png', size: 20 }, { type: 'image/png', size: 30 }];
  t.screen.newInput.file = cover;
  t.screen.newInput.ocrFiles = shots;
  await t.controller.readText('new', null, 'ocr');
  assert.deepEqual(t.calls.ocr, shots);
  assert.deepEqual(t.screen.inserted, { which: 'new', text: '材料：米粉\n\n作り方' });
  assert.ok(t.screen.ocrStates.some(state => state.busy && /^2\/2枚目：文字を読み取っています… 50%/.test(state.message)));
  assert.match(t.screen.notices.at(-1).message, /2枚分の文字をメモに入れました。.*「すべて削除」/);
  assert.equal(t.screen.notices.at(-1).error, false);
  await t.controller.saveNew();
  // アップロードは1回（カバーのみ）。
  assert.equal(t.calls.upload, 1);
  assert.equal(t.calls.create[0].thumbnail_url, 'https://res.cloudinary.com/demo/image/upload/new.jpg');
});

test('新規投稿：読み取れなかった画像は飛ばし、何枚目かを知らせる', async () => {
  const texts = ['材料 米粉', '|', '作り方'];
  const t = harness({ ocr: { async recognize() { return texts.shift(); } } });
  await t.ready();
  t.screen.newInput.ocrFiles = [1, 2, 3].map(size => ({ type: 'image/png', size }));
  await t.controller.readText('new', null, 'ocr');
  assert.equal(t.screen.inserted.text, '材料米粉\n\n作り方');
  assert.match(t.screen.notices.at(-1).message, /2枚分.*2枚目は文字を読み取れませんでした/);
  assert.equal(t.screen.notices.at(-1).error, true);
});

test('新規投稿：文字読み取り用の画像だけでは保存できず、未保存の変更として扱う', async () => {
  const t = harness();
  await t.ready();
  t.screen.newInput = { url: '', memo: '', category: '', file: null, ocrFiles: [{ type: 'image/png', size: 10 }] };
  assert.equal(t.controller.hasUnsavedChanges(), true);
  t.screen.newInput.ocrFiles = [];
  assert.equal(t.controller.hasUnsavedChanges(), false);
  t.screen.newInput.ocrFiles = [{ type: 'image/png', size: 10 }];
  await t.controller.saveNew();
  assert.equal(t.calls.upload, 0);
  assert.equal(t.calls.create.length, 0);
  assert.match(t.screen.notices.at(-1).message, /投稿URLまたは画像/);
  t.screen.newInput.ocrFiles = [];
  await t.controller.readText('new', null, 'ocr');
  assert.match(t.screen.notices.at(-1).message, /先に画像/);
});

test('新規投稿：読み取り中に一覧が変わったら中止し、メモには何も入れない', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const t = harness({ ocr: { async recognize() { await gate; return '材料 米粉'; } } });
  await t.ready();
  const shots = [{ type: 'image/png', size: 10 }, { type: 'image/png', size: 20 }];
  t.screen.newInput.ocrFiles = [...shots];
  const run = t.controller.readText('new', null, 'ocr');
  t.screen.newInput.ocrFiles = [shots[1]];
  release();
  await run;
  assert.equal(t.screen.inserted, undefined);
  assert.match(t.screen.notices.at(-1).message, /画像が変わった/);
  assert.equal(t.screen.ocrStates.at(-1).busy, false);
});

test('共有で文字読み取り用の画像だけが届いてもフォームに入れ、上限を超えた枚数を知らせる', async () => {
  const t = harness();
  const ocrFiles = [{ type: 'image/png', size: 10 }];
  t.controller.setShared({ url: '', memo: '', category: '', file: null, ocrFiles, dropped: 2 });
  await t.ready();
  assert.equal(t.screen.shared.ocrFiles, ocrFiles);
  assert.match(t.screen.notices.at(-1).message, /5枚までのため、2枚は入れていません/);
  t.controller.setShared({ url: '', memo: '', category: '', file: null, ocrFiles: [] });
  t.screen.shared = null;
  await t.auth(null);
  await t.ready();
  assert.equal(t.screen.shared, null);
});

test('ログイン処理が終わらなくても、ログイン状態が変われば別アカウントからログアウトできる', async () => {
  // iPadのホーム画面アプリで、ログイン画面が閉じた知らせが届かない場合を再現する。
  let logouts = 0;
  const t = harness({ login: () => new Promise(() => {}), async logout() { logouts++; } });
  await t.auth(null);
  void t.controller.login();
  await tick();
  assert.equal(t.screen.busy.authBusy, true);
  await t.auth('someone-else');
  assert.equal(t.screen.auth, 'denied');
  assert.equal(t.screen.busy.authBusy, false);
  await t.controller.logout();
  assert.equal(logouts, 1);
});

test('新規登録で表示位置を調整した画像は、保存時にその範囲と位置をURLに入れる', async () => {
  const t = harness({ async upload() { return 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v1/new.jpg'; } });
  await t.ready();
  const file = { type: 'image/png', size: 100 };
  // 位置だけ変えた場合：自動の上下カットは外し、元の画像に位置を付ける。
  t.screen.newInput = { ...t.screen.newInput, file, crop: { rect: { x: 0, y: 0, w: 1, h: 1 }, focus: { x: 0.5, y: 0.2 } } };
  await t.controller.saveNew();
  assert.equal(t.calls.create.at(-1).thumbnail_url, 'https://res.cloudinary.com/demo/image/upload/v1/new.jpg#pos=0.500,0.200');
  // 範囲も切り抜いた場合。
  t.screen.newInput = { url: '', memo: '', category: '', file, crop: { rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, focus: { x: 0.5, y: 0.5 } } };
  await t.controller.saveNew();
  assert.equal(t.calls.create.at(-1).thumbnail_url, 'https://res.cloudinary.com/demo/image/upload/c_crop,x_0.1000,y_0.2000,w_0.5000,h_0.4000/v1/new.jpg');
  // 調整しなかった場合は、これまでどおり。
  t.screen.newInput = { url: '', memo: '', category: '', file, crop: null };
  await t.controller.saveNew();
  assert.equal(t.calls.create.at(-1).thumbnail_url, 'https://res.cloudinary.com/demo/image/upload/c_crop,w_1.0,h_0.84,y_0.08/v1/new.jpg');
});
