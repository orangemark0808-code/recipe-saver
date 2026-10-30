import { CENTER_POSITION, DEFAULT_CATEGORIES, FULL_CROP, OCR_IMAGE_LIMIT, asText, canCropImage, cleanOcrText, cropImageUrl, isFullCrop, originalImageUrl, parseCropRect, parseThumbPosition, withThumbPosition, filterRecipes, newCategoryId, normalizeCategory, normalizePostUrl, normalizeRecipe, sanitizeCategories, validateCategories, validateImage, validateMemo } from './core.mjs';

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
    // iPadのホーム画面アプリでは、ログイン画面が閉じた知らせが届かず「処理中」のまま止まることがある。
    // ログイン状態が変わった時点で処理は終わっているので、ここで解除してログアウトを押せるようにする。
    state.authBusy = false;
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
    // 上限を超えて入れられなかった画像があれば、あわせて知らせる。
    const dropped = shared.dropped > 0 ? `文字読み取り用の画像は${OCR_IMAGE_LIMIT}枚までのため、${shared.dropped}枚は入れていません。` : '';
    view.notify(`共有された内容を入力しました。${dropped}確認して保存してください。`, !!dropped);
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
      let thumbnail = file ? await backend.upload(file) : null;
      // 新規登録時に「表示位置を調整」していれば、その範囲と位置をアップロードした画像のURLに入れる。
      // 調整画面では元の画像全体を見て決めているので、自動の上下カットより手動の指定を優先する。
      if (thumbnail && input.crop && canCropImage(thumbnail)) {
        const { rect, focus } = input.crop;
        thumbnail = withThumbPosition(isFullCrop(rect) ? originalImageUrl(thumbnail) : cropImageUrl(thumbnail, rect), focus);
      }
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
    return !!(input.url || input.memo || input.category || input.file || input.ocrFiles?.length);
  }
  function hasEditChanges() {
    if (!state.edit) return false;
    const input = view.readEdit();
    return !!input.file || input.memo !== state.edit.memo || input.category !== state.edit.category || asText(input.url).trim() !== state.edit.url
      || (state.edit.cropUrl !== null && state.edit.cropUrl !== state.edit.thumb);
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
    state.edit = { id, memo: recipe.memo, category: recipe.category, url: recipe.post_url, thumb: recipe.thumbnail_url, cropBase: '', cropUrl: null };
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
      // トリミングだけ変えた場合は、画像は上げ直さず、切り抜き指定つきのURLに差し替える。
      if (!file && edit.cropUrl && edit.cropUrl !== edit.thumb) update.thumbnail_url = edit.cropUrl;
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
  // 新規投稿では slot で画像を選ぶ：'cover'（カバー画像1枚）か 'ocr'（文字読み取り用の一覧を上から順にすべて）。
  const ocrMessages = { prepare: '準備しています（初回は部品の読み込みに時間がかかります）…', read: '文字を読み取っています…' };
  const sameFiles = (a, b) => a.length === b.length && a.every((file, index) => file === b[index]);
  async function readText(which, picked = null, slot = 'cover') {
    if (state.ocrBusy) return;
    const token = session;
    const fromList = which === 'new' && slot === 'ocr';
    try {
      if (!authorized()) throw new Error('ご本人のアカウントでログインしてください。');
      if (!ocr) throw new Error('文字の読み取りを利用できません。');
      const edit = state.edit;
      let sources;
      // 別のスクショを選んだ場合は、その画像だけを読み取る（投稿の画像は変えない・保存もしない）。
      if (picked) sources = [validateImage(picked)];
      else if (which === 'edit') {
        const recipe = state.recipes.find(item => item.id === edit?.id);
        // 新しく選んだ画像を優先し、なければ保存済みの画像（切り抜く前の元の画像）を使う。
        sources = [view.readEdit().file || (recipe?.thumbnail_url ? originalImageUrl(recipe.thumbnail_url) : null)];
      } else if (fromList) sources = [...(view.readNew().ocrFiles || [])];
      else sources = [view.readNew().file];
      sources = sources.filter(Boolean);
      if (!sources.length) throw new Error('先に画像を選んでください。');
      // 読み取り中に画像や編集対象が変わっていないか。変わっていたら結果は入れない。
      const unchanged = () => which === 'edit' ? state.edit === edit
        : fromList ? sameFiles(view.readNew().ocrFiles || [], sources)
        : view.readNew().file === sources[0];
      state.ocrBusy = which;
      const total = sources.length;
      const texts = [];
      const unreadable = [];
      for (const [index, source] of sources.entries()) {
        // 2枚以上のときは「2/3枚目：」のように何枚目かを添える。
        const prefix = total > 1 ? `${index + 1}/${total}枚目：` : '';
        view.setOcr(which, { busy: true, message: prefix + ocrMessages.prepare });
        const text = cleanOcrText(await ocr.recognize(source, ({ stage, progress }) => {
          if (!isCurrent(token)) return;
          const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
          view.setOcr(which, { busy: true, message: prefix + (stage === 'read' ? `${ocrMessages.read} ${percent}%` : ocrMessages.prepare) });
        }));
        if (!isCurrent(token)) return;
        if (!unchanged()) {
          if (fromList) view.notify('読み取り中に画像が変わったため、メモには入れませんでした。もう一度お試しください。', true);
          return;
        }
        if (text) texts.push(text);
        else unreadable.push(index + 1);
      }
      if (!texts.length) { view.notify('文字を読み取れませんでした。文字がはっきり写った画像でお試しください。', true); return; }
      // 複数枚の文字は、空行で区切って順番どおりにメモへ入れる。
      view.insertMemoText(which, texts.join('\n\n'));
      if (!fromList) { view.notify('メモに読み取った文字を入れました。誤りがないか確認してください。'); return; }
      const skipped = unreadable.length ? `${unreadable.join('・')}枚目は文字を読み取れませんでした。` : '';
      view.notify(`${texts.length}枚分の文字をメモに入れました。${skipped}確認したら、読み取り用の画像は「すべて削除」で消せます（保存はされません）。`, !!skipped);
    } catch (error) { if (session === token) view.notify(message(error), true); }
    finally {
      state.ocrBusy = '';
      if (session === token) view.setOcr(which, { busy: false });
    }
  }

  // 画像のトリミング。編集画面から開き、範囲を決めて「適用」すると、編集画面のサムネイルに反映される。
  function openCrop() {
    const edit = state.edit;
    if (!authorized() || !edit || state.savingEdit) return;
    const current = edit.cropUrl ?? edit.thumb;
    if (!canCropImage(current)) { view.notify('この画像はトリミングできません。', true); return; }
    edit.cropBase = originalImageUrl(current);
    view.openCrop({ url: edit.cropBase, rect: parseCropRect(current) ?? { ...FULL_CROP }, focus: parseThumbPosition(current) ?? { ...CENTER_POSITION } });
  }
  function applyCrop(rect, focus) {
    const edit = state.edit;
    if (!authorized() || !edit?.cropBase) return;
    // 切り抜き範囲と、一覧に表示する部分の位置を、1つのURLにまとめる。
    edit.cropUrl = withThumbPosition(isFullCrop(rect) ? edit.cropBase : cropImageUrl(edit.cropBase, rect), focus);
    view.setEditThumbnail(edit.cropUrl);
    view.closeCrop();
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
    setShared(shared) { state.shared = shared && (shared.url || shared.memo || shared.category || shared.file || shared.ocrFiles?.length) ? shared : null; },
    reload, saveNew, saveEdit, openEdit, openCrop, applyCrop, closeCrop: () => view.closeCrop(), readText, openCategories, closeCategories, saveCategories, closeEdit: () => closeEdit(), openDetail, closeDetail, hasUnsavedChanges,
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
