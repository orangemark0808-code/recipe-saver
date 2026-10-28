import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.mjs';
import { normalizeRecipe } from '../src/core.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const makeRecipe = (id, category = 'main') => normalizeRecipe(id, { memo: `${id}のメモ`, category, post_url: 'https://www.instagram.com/p/example/', favorite: false });

function harness(overrides = {}) {
  let authCallback;
  const calls = { list: 0, create: [], update: [], remove: [], upload: 0 };
  const screen = { notices: [], lists: [], closed: 0, cleared: 0, newInput: { url: 'https://www.instagram.com/p/example/', memo: '新しいメモ', category: 'snack', file: null }, editInput: { memo: '更新メモ', category: 'main', file: null } };
  const backend = {
    watchAuth(callback) { authCallback = callback; return () => {}; },
    async login() {}, async logout() { authCallback(null); },
    async list() { calls.list++; return [makeRecipe('A'), makeRecipe('B', 'side')]; },
    async create(data) { calls.create.push(data); return 'C'; },
    async update(id, data) { calls.update.push({ id, data }); },
    async remove(id) { calls.remove.push(id); },
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
    openEdit(recipe) { screen.edit = recipe; screen.editInput = { memo: recipe.memo, category: recipe.category, file: null }; },
    closeEdit() { screen.closed++; screen.edit = null; },
    confirmDelete() { return true; },
    confirmDiscard() { screen.discardAsked = (screen.discardAsked || 0) + 1; return screen.allowDiscard ?? true; },
    applyShared(shared) { screen.shared = shared; },
    readNew() { return screen.newInput; }, readEdit() { return screen.editInput; }
  };
  const controller = createController({ backend, view, ownerUid: 'owner', now: () => new Date('2026-10-28T00:00:00Z') });
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
