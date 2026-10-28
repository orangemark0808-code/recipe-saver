import { asText, filterRecipes, normalizeCategory, normalizePostUrl, normalizeRecipe, validateImage, validateMemo } from './core.mjs';

export function createController({ backend, view, ownerUid, now = () => new Date() }) {
  const state = {
    user: null, recipes: [], loaded: false, loading: false, error: '',
    category: '', search: '', edit: null, detail: null, savingNew: false, savingEdit: false,
    pendingIds: new Set(), authBusy: false, shared: null
  };
  let session = 0;
  let loadVersion = 0;
  let stopAuth = () => {};
  let disposed = false;
  const authorized = () => !disposed && !!ownerUid && state.user?.uid === ownerUid;
  const isCurrent = token => authorized() && session === token;
  const busy = () => state.savingNew || state.savingEdit || state.pendingIds.size > 0;
  const message = error => asText(error?.message) || '処理に失敗しました。もう一度お試しください。';

  function updateControls() {
    view.setBusy({ ...state, authorized: authorized(), actionsBusy: busy() });
  }
  function render() {
    if (state.detail) {
      const recipe = state.recipes.find(item => item.id === state.detail);
      if (recipe) view.renderDetail(recipe);
      else closeDetail();
    }
    view.renderList({
      recipes: filterRecipes(state.recipes, state.category, state.search),
      total: state.recipes.length, category: state.category, search: state.search,
      loading: state.loading, error: state.error, pendingIds: state.pendingIds
    });
    updateControls();
  }
  function requireReady() {
    if (!authorized()) throw new Error('ご本人のアカウントでログインしてください。');
    if (!state.loaded || state.loading) throw new Error('投稿の読み込みが完了してから操作してください。');
  }

  async function reload() {
    if (!authorized() || busy()) return;
    const token = session;
    const request = ++loadVersion;
    state.loading = true;
    state.error = '';
    render();
    try {
      const recipes = await backend.list();
      if (!isCurrent(token) || request !== loadVersion) return;
      state.recipes = recipes.map(recipe => normalizeRecipe(recipe.id, recipe));
      state.loaded = true;
    } catch (error) {
      if (!isCurrent(token) || request !== loadVersion) return;
      state.error = '投稿を読み込めませんでした。通信状態を確認して再試行してください。';
    } finally {
      if (isCurrent(token) && request === loadVersion) {
        state.loading = false;
        render();
      }
    }
  }

  async function onAuth(user) {
    if (disposed) return;
    session++;
    loadVersion++;
    state.user = user;
    state.recipes = [];
    state.loaded = false;
    state.loading = false;
    state.error = '';
    state.edit = null;
    state.detail = null;
    state.savingNew = false;
    state.savingEdit = false;
    state.pendingIds.clear();
    state.category = '';
    state.search = '';
    view.reset();
    view.setAuth(user ? authorized() ? 'owner' : 'denied' : 'signed-out');
    render();
    if (user && !authorized()) state.shared = null;
    if (authorized()) { await reload(); applyShared(); }
  }

  // 共有メニューから届いた内容は、本人のログインと一覧の読み込みが済んでからフォームに入れる。
  function applyShared() {
    if (!authorized() || !state.shared) return;
    const shared = state.shared;
    state.shared = null;
    view.applyShared(shared);
    view.notify('共有された内容を入力しました。確認して保存してください。');
  }

  async function authAction(action) {
    if (state.authBusy || busy()) return;
    state.authBusy = true;
    updateControls();
    try { await action(); }
    catch (error) {
      const cancelled = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code);
      view.notify(cancelled ? 'ログインをキャンセルしました。' : 'ログイン操作に失敗しました。通信状態とFirebaseの認証設定をご確認ください。', !cancelled);
    } finally {
      state.authBusy = false;
      updateControls();
    }
  }

  async function saveNew() {
    if (state.savingNew) return;
    const token = session;
    try {
      requireReady();
      const input = view.readNew();
      const url = normalizePostUrl(input.url);
      const memo = validateMemo(input.memo);
      const file = validateImage(input.file);
      if (!url && !file) throw new Error('投稿URLまたは画像を指定してください。');
      const category = normalizeCategory(input.category);
      state.savingNew = true;
      updateControls();
      const thumbnail = file ? await backend.upload(file) : null;
      // アップロード中のログアウトなどで、別セッションへ処理を持ち越さない。
      if (!isCurrent(token)) return;
      const date = now();
      const data = {
        post_url: url, memo, category, thumbnail_url: thumbnail,
        favorite: false, created_at: date.toISOString(),
        saved_date: date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
      };
      const id = await backend.create(data);
      if (!isCurrent(token)) return;
      state.recipes = [normalizeRecipe(id, data), ...state.recipes];
      view.clearNew();
      render();
      view.notify('保存しました！');
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      if (session === token) { state.savingNew = false; updateControls(); }
    }
  }

  function hasNewChanges() {
    const input = view.readNew();
    return !!(input.url || input.memo || input.category || input.file);
  }
  function hasEditChanges() {
    if (!state.edit) return false;
    const input = view.readEdit();
    return !!input.file || input.memo !== state.edit.memo || input.category !== state.edit.category;
  }
  function hasUnsavedChanges() { return hasNewChanges() || hasEditChanges(); }
  function openDetail(id) {
    if (!authorized() || state.edit || state.pendingIds.has(id)) return;
    const recipe = state.recipes.find(item => item.id === id);
    if (!recipe) return;
    state.detail = id;
    view.openDetail(recipe);
  }
  function closeDetail() {
    if (state.edit) return;
    state.detail = null;
    view.closeDetail();
  }
  function openEdit(id) {
    if (!authorized() || state.savingEdit || state.pendingIds.has(id)) return;
    const recipe = state.recipes.find(item => item.id === id);
    if (!recipe) return;
    if (hasEditChanges() && !view.confirmDiscard()) return;
    state.edit = { id, memo: recipe.memo, category: recipe.category };
    view.openEdit(recipe);
  }
  function closeEdit(discardConfirmed = false) {
    if (state.savingEdit) { view.notify('保存中です。完了までお待ちください。'); return; }
    if (!discardConfirmed && hasEditChanges() && !view.confirmDiscard()) return;
    state.edit = null;
    view.closeEdit();
  }

  async function saveEdit() {
    if (state.savingEdit) return;
    const token = session;
    // await より前に対象を固定。後から変わる画面の選択状態は更新先に使わない。
    const edit = state.edit;
    try {
      requireReady();
      if (!edit?.id || !state.recipes.some(item => item.id === edit.id)) throw new Error('編集する投稿を選んでください。');
      const input = view.readEdit();
      const update = { memo: validateMemo(input.memo), category: normalizeCategory(input.category) };
      const file = validateImage(input.file);
      state.savingEdit = true;
      updateControls();
      if (file) update.thumbnail_url = await backend.upload(file);
      if (!isCurrent(token)) return;
      await backend.update(edit.id, update);
      if (!isCurrent(token)) return;
      state.recipes = state.recipes.map(recipe => recipe.id === edit.id ? { ...recipe, ...update } : recipe);
      state.savingEdit = false;
      if (state.edit === edit) closeEdit(true);
      render();
      view.notify('更新しました！');
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      if (session === token) { state.savingEdit = false; updateControls(); }
    }
  }

  async function changeRecipe(id, removing = false) {
    if (state.pendingIds.has(id)) return;
    const token = session;
    try {
      requireReady();
      const recipe = state.recipes.find(item => item.id === id);
      if (!recipe) return;
      if (removing && !view.confirmDelete()) return;
      state.pendingIds.add(id);
      render();
      if (removing) await backend.remove(id);
      else await backend.update(id, { favorite: !recipe.favorite });
      if (!isCurrent(token)) return;
      state.recipes = removing ? state.recipes.filter(item => item.id !== id) : state.recipes.map(item => item.id === id ? { ...item, favorite: !recipe.favorite } : item);
      if (removing) view.notify('削除しました。');
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      if (session === token) { state.pendingIds.delete(id); render(); }
    }
  }

  const actions = {
    login: () => authAction(() => backend.login()),
    logout: () => { if (!hasUnsavedChanges() || view.confirmDiscard()) return authAction(() => backend.logout()); },
    setShared(shared) { state.shared = shared && (shared.url || shared.memo || shared.category || shared.file) ? shared : null; },
    reload, saveNew, saveEdit, openEdit, closeEdit: () => closeEdit(), openDetail, closeDetail, hasUnsavedChanges,
    clearNew: () => { if (!state.savingNew && (!hasNewChanges() || view.confirmDiscard())) view.clearNew(); },
    search(value) { state.search = asText(value); render(); },
    filter(value) { state.category = value === 'favorites' ? value : normalizeCategory(value); render(); },
    clearFilters() { state.search = ''; state.category = ''; view.clearFilters(); render(); },
    toggleFavorite: id => changeRecipe(id),
    deleteRecipe: id => changeRecipe(id, true),
    start() {
      view.bind(actions);
      stopAuth = backend.watchAuth(user => { void onAuth(user); }, () => {
        void onAuth(null);
        view.setAuth('error');
      });
    },
    dispose() { disposed = true; session++; stopAuth(); view.destroy(); }
  };
  return actions;
}
