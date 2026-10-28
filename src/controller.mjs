import { DEFAULT_CATEGORIES, asText, cleanOcrText, originalImageUrl, filterRecipes, newCategoryId, normalizeCategory, normalizePostUrl, normalizeRecipe, sanitizeCategories, validateCategories, validateImage, validateMemo } from './core.mjs';

export function createController({ backend, view, ownerUid, ocr, now = () => new Date() }) {
  const state = {
    user: null, recipes: [], loaded: false, loading: false, error: '',
    category: '', search: '', edit: null, detail: null, savingNew: false, savingEdit: false,
    pendingIds: new Set(), authBusy: false, shared: null,
    categories: DEFAULT_CATEGORIES, savingCategories: false, categoryDialog: false, ocrBusy: ''
  };
  let session = 0;
  let loadVersion = 0;
  let stopAuth = () => {};
  let disposed = false;
  const authorized = () => !disposed && !!ownerUid && state.user?.uid === ownerUid;
  const isCurrent = token => authorized() && session === token;
  const busy = () => state.savingNew || state.savingEdit || state.savingCategories || state.pendingIds.size > 0;
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
      recipes: filterRecipes(state.recipes, state.category, state.search, state.categories),
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
      // カテゴリの設定が読めなくても投稿は表示する（初期カテゴリを使う）。
      const [recipes, categories] = await Promise.all([
        backend.list(),
        Promise.resolve().then(() => backend.loadCategories()).then(sanitizeCategories, () => null)
      ]);
      if (!isCurrent(token) || request !== loadVersion) return;
      state.categories = categories || DEFAULT_CATEGORIES;
      view.setCategories(state.categories);
      state.recipes = recipes.map(recipe => normalizeRecipe(recipe.id, recipe, state.categories));
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
    state.categories = DEFAULT_CATEGORIES;
    state.savingCategories = false;
    state.categoryDialog = false;
    state.ocrBusy = '';
    view.setCategories(DEFAULT_CATEGORIES);
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
      const category = normalizeCategory(input.category, state.categories);
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
      state.recipes = [normalizeRecipe(id, data, state.categories), ...state.recipes];
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
    return !!input.file || input.memo !== state.edit.memo || input.category !== state.edit.category || asText(input.url).trim() !== state.edit.url;
  }
  function hasUnsavedChanges() { return hasNewChanges() || hasEditChanges() || (state.categoryDialog && view.categoriesChanged()); }
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
    state.edit = { id, memo: recipe.memo, category: recipe.category, url: recipe.post_url };
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
      const update = { memo: validateMemo(input.memo), category: normalizeCategory(input.category, state.categories) };
      const file = validateImage(input.file);
      // URLは変えたときだけ検証して更新する（保存済みの古いURLを、触らないまま弾かないため）。
      if (asText(input.url).trim() !== edit.url) {
        const url = normalizePostUrl(input.url);
        const current = state.recipes.find(item => item.id === edit.id);
        if (!url && !file && !current?.thumbnail_url) throw new Error('投稿URLまたは画像を指定してください。');
        update.post_url = url;
      }
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

  // 画像から文字を読み取って、メモに追記する。'new' は新規投稿、'edit' は編集中の投稿。
  const ocrMessages = { prepare: '準備しています（初回は部品の読み込みに時間がかかります）…', read: '文字を読み取っています…' };
  async function readText(which) {
    if (state.ocrBusy) return;
    const token = session;
    try {
      if (!authorized()) throw new Error('ご本人のアカウントでログインしてください。');
      if (!ocr) throw new Error('文字の読み取りを利用できません。');
      const edit = state.edit;
      let source;
      if (which === 'edit') {
        const recipe = state.recipes.find(item => item.id === edit?.id);
        // 新しく選んだ画像を優先し、なければ保存済みの画像（切り抜く前の元の画像）を使う。
        source = view.readEdit().file || (recipe?.thumbnail_url ? originalImageUrl(recipe.thumbnail_url) : null);
      } else source = view.readNew().file;
      if (!source) throw new Error('先に画像を選んでください。');
      state.ocrBusy = which;
      view.setOcr(which, { busy: true, message: ocrMessages.prepare });
      const text = cleanOcrText(await ocr.recognize(source, ({ stage, progress }) => {
        if (!isCurrent(token)) return;
        const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
        view.setOcr(which, { busy: true, message: stage === 'read' ? `${ocrMessages.read} ${percent}%` : ocrMessages.prepare });
      }));
      if (!isCurrent(token)) return;
      // 読み取り中に画像や編集対象が変わったら、結果は入れない。
      const unchanged = which === 'edit' ? state.edit === edit : view.readNew().file === source;
      if (!unchanged) return;
      if (!text) { view.notify('文字を読み取れませんでした。文字がはっきり写った画像でお試しください。', true); return; }
      view.insertMemoText(which, text);
      view.notify('メモに読み取った文字を入れました。誤りがないか確認してください。');
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      state.ocrBusy = '';
      if (session === token) view.setOcr(which, { busy: false });
    }
  }

  function openCategories() {
    if (!authorized() || !state.loaded || state.loading || busy()) return;
    state.categoryDialog = true;
    view.openCategories(state.categories);
  }
  function closeCategories() {
    if (state.savingCategories) { view.notify('保存中です。完了までお待ちください。'); return; }
    if (view.categoriesChanged() && !view.confirmDiscard()) return;
    state.categoryDialog = false;
    view.closeCategories();
  }
  async function saveCategories() {
    if (state.savingCategories) return;
    const token = session;
    try {
      requireReady();
      const rows = view.readCategories();
      // 新しく追加した行にだけ識別子を付ける。既存の行は今の識別子のまま（投稿との対応を保つ）。
      const used = rows.filter(row => row.value).map(row => ({ value: row.value }));
      const categories = validateCategories(rows.map(row => {
        const value = row.value || newCategoryId(used);
        if (!row.value) used.push({ value });
        return { value, label: row.label, color: row.color };
      }));
      const removed = state.categories.filter(item => !categories.some(next => next.value === item.value));
      const posts = state.recipes.filter(recipe => removed.some(item => item.value === recipe.category)).length;
      if (removed.length && !view.confirmCategoryRemoval({ names: removed.map(item => item.label), posts })) return;
      state.savingCategories = true;
      updateControls();
      await backend.saveCategories(categories);
      if (!isCurrent(token)) return;
      state.categories = categories;
      // 削除したカテゴリの投稿は、再読み込みしたときと同じ扱い（その他／未分類）にそろえる。
      state.recipes = state.recipes.map(recipe => ({ ...recipe, category: normalizeCategory(recipe.category, categories) }));
      if (state.category && state.category !== 'favorites' && !categories.some(item => item.value === state.category)) state.category = '';
      state.savingCategories = false;
      state.categoryDialog = false;
      view.closeCategories();
      view.setCategories(categories);
      render();
      view.notify('カテゴリを保存しました！');
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      if (session === token) { state.savingCategories = false; updateControls(); }
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
    reload, saveNew, saveEdit, openEdit, readText, openCategories, closeCategories, saveCategories, closeEdit: () => closeEdit(), openDetail, closeDetail, hasUnsavedChanges,
    clearNew: () => { if (!state.savingNew && (!hasNewChanges() || view.confirmDiscard())) view.clearNew(); },
    search(value) { state.search = asText(value); render(); },
    filter(value) { state.category = value === 'favorites' ? value : normalizeCategory(value, state.categories); render(); },
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
