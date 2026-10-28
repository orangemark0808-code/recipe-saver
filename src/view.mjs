import { CATEGORIES, categoryLabel, originalImageUrl, safePostUrl, safeImageUrl, validateImage } from './core.mjs';

export function createView(document, { origin = location.origin, objectUrls = URL, confirmDelete = () => confirm('この投稿を削除しますか？'), confirmDiscard = () => confirm('保存していない変更があります。変更を破棄しますか？') } = {}) {
  const get = id => document.getElementById(id);
  const cards = new Map();
  const previews = { main: null, modal: null };
  const files = { main: null, modal: null };
  let actions;
  let toastTimer;
  let editTrigger;
  let detailTrigger;
  let detailRecipe;
  const listeners = new AbortController();
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
  const act = callback => {
    Promise.resolve().then(callback).catch(() => notify('操作を完了できませんでした。もう一度お試しください。', true));
  };

  function notify(message, error = false) {
    const toast = get('customToast');
    toast.setAttribute('role', error ? 'alert' : 'status');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), error ? 6000 : 2500);
  }

  function placeholder(category) {
    const element = make('div', 'placeholder-card');
    element.append(make('div', 'no-image-logo', categoryLabel(category) || 'NO IMAGE'));
    return element;
  }
  function renderThumbnail(container, url, category, preview = false) {
    container.replaceChildren();
    const src = preview ? url : safeImageUrl(url, origin);
    container.classList.toggle('no-image', !src);
    if (!src) { container.append(placeholder(category)); return; }
    const img = make('img');
    img.alt = '投稿の画像';
    img.loading = preview ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    // 切り抜き指定つきURLが表示できないときは、一度だけ元画像のURLで再試行する。
    let triedOriginal = false;
    img.addEventListener('error', () => {
      const original = originalImageUrl(src);
      if (!triedOriginal && original !== src) { triedOriginal = true; img.src = original; return; }
      container.classList.add('no-image');
      container.replaceChildren(placeholder(category));
    });
    img.src = src;
    container.append(img);
  }

  function makeCard(recipe) {
    const card = make('article', 'recipe-card');
    card.dataset.recipeId = recipe.id;
    const url = safePostUrl(recipe.post_url);
    const image = make(url ? 'a' : 'button', 'recipe-image-wrapper recipe-image-link');
    if (url) {
      image.href = url;
      image.target = '_blank';
      image.rel = 'noopener noreferrer';
      image.setAttribute('aria-label', `${recipe.memo.slice(0, 40) || '保存済み投稿'}：元の投稿を開く（新しいタブ）`);
      image.title = '元の投稿を開く';
    } else {
      image.type = 'button';
      image.dataset.action = 'detail-image';
      image.setAttribute('aria-label', `${recipe.memo.slice(0, 40) || '保存済み投稿'}：詳細を読む（投稿URLなし）`);
      image.addEventListener('click', () => actions.openDetail(recipe.id));
    }
    renderThumbnail(image, recipe.thumbnail_url, recipe.category);
    const content = make('div', 'recipe-content');
    const edit = make('button', 'recipe-edit-zone');
    edit.type = 'button';
    edit.dataset.action = 'detail';
    edit.setAttribute('aria-label', `${recipe.memo.slice(0, 40) || 'メモなし'}：詳細を読む`);
    if (recipe.category) edit.append(make('span', 'recipe-category', categoryLabel(recipe.category)));
    edit.append(make('span', `recipe-memo${recipe.memo ? '' : ' empty'}`, recipe.memo.slice(0, 100) || 'メモなし'));
    edit.append(make('span', 'edit-hint', '詳細を読む'));
    edit.addEventListener('click', () => actions.openDetail(recipe.id));
    const footer = make('div', 'recipe-footer');
    footer.append(make('span', 'recipe-date', recipe.saved_date));
    const buttons = make('div', 'footer-actions');
    const remove = make('button', 'delete-btn', '🗑️');
    remove.type = 'button';
    remove.title = '削除';
    remove.dataset.action = 'delete';
    remove.setAttribute('aria-label', '投稿を削除');
    remove.addEventListener('click', () => act(() => actions.deleteRecipe(recipe.id)));
    const favorite = make('button', `favorite-btn${recipe.favorite ? ' active' : ''}`, recipe.favorite ? '★' : '☆');
    favorite.type = 'button';
    favorite.title = 'お気に入り';
    favorite.dataset.action = 'favorite';
    favorite.setAttribute('aria-label', recipe.favorite ? 'お気に入りから外す' : 'お気に入りに追加');
    favorite.setAttribute('aria-pressed', String(recipe.favorite));
    favorite.addEventListener('click', () => act(() => actions.toggleFavorite(recipe.id)));
    buttons.append(remove, favorite);
    footer.append(buttons);
    content.append(edit, footer);
    card.append(image, content);
    return card;
  }

  function emptyState(message, buttonLabel, callback) {
    const box = make('div', 'empty-state');
    box.append(make('p', '', message));
    if (buttonLabel) {
      const button = make('button', '', buttonLabel);
      button.type = 'button';
      button.addEventListener('click', () => act(callback));
      box.append(button);
    }
    return box;
  }

  function renderList({ recipes, total, search, category, loading, error, pendingIds }) {
    const grid = get('recipesGrid');
    get('recipeCount').textContent = search.trim() || category ? `${recipes.length}件 / 全${total}件` : `${total}件`;
    grid.setAttribute('aria-busy', String(loading));
    if (loading) { grid.replaceChildren(emptyState('投稿を読み込んでいます…')); return; }
    if (error) { grid.replaceChildren(emptyState(error, '再試行', () => actions.reload())); return; }
    if (!recipes.length) {
      cards.clear();
      const filtered = !!search.trim() || !!category;
      grid.replaceChildren(emptyState(filtered ? '条件に一致する投稿がありません。' : '保存済み投稿はまだありません。', filtered ? '検索条件を解除' : '', () => actions.clearFilters()));
      return;
    }
    const focused = document.activeElement;
    const focusedId = focused?.closest('[data-recipe-id]')?.dataset.recipeId;
    const focusedAction = focused?.dataset.action;
    const nodes = recipes.map(recipe => {
      const cached = cards.get(recipe.id);
      const card = cached?.recipe === recipe ? cached.node : makeCard(recipe);
      cards.set(recipe.id, { recipe, node: card });
      for (const button of card.querySelectorAll('button')) button.disabled = pendingIds.has(recipe.id);
      return card;
    });
    // 同じ検索結果ならDOMを作り直さず、画像の再読込やフォーカス消失を防ぐ。
    if (nodes.length !== grid.children.length || nodes.some((node, index) => grid.children[index] !== node)) {
      grid.replaceChildren(...nodes);
      if (focusedId && focusedAction && !focused.isConnected) {
        const replacement = cards.get(focusedId)?.node;
        if (replacement?.isConnected) [...replacement.querySelectorAll('button')].find(button => button.dataset.action === focusedAction)?.focus();
        else get('searchInput').focus();
      }
    }
    // キャッシュは表示中のカードだけ保持。検索・削除後の大きな画像を持ち続けない。
    const visible = new Set(recipes.map(recipe => recipe.id));
    for (const id of cards.keys()) if (!visible.has(id)) cards.delete(id);
  }

  // 入力内容が変わったことを知らせる（下書きの自動保存用）。プログラムによる初期化では呼ばない。
  let draftListener = () => {};
  const touchDraft = () => draftListener();
  function releasePreview(which) {
    if (previews[which]) objectUrls.revokeObjectURL(previews[which]);
    previews[which] = null;
  }
  function clearImage() {
    releasePreview('main');
    files.main = null;
    get('imageInput').value = '';
    get('previewImg').removeAttribute('src');
    get('imagePreview').hidden = true;
    get('uploadArea').hidden = false;
  }
  function chooseImage(which, file) {
    if (!file) return;
    try { validateImage(file); } catch (error) { notify(error.message, true); return; }
    releasePreview(which);
    files[which] = file;
    previews[which] = objectUrls.createObjectURL(file);
    if (which === 'main') {
      get('previewImg').src = previews.main;
      get('imagePreview').hidden = false;
      get('uploadArea').hidden = true;
      touchDraft();
    } else renderThumbnail(get('modalThumbnail'), previews.modal, '', true);
  }
  // ログアウトや再読み込みなどの初期化。下書きには触れない。
  function resetNew() {
    get('newForm').reset();
    clearImage();
  }
  // 保存後・クリアボタン。入力欄を空にし、下書きも空にする。
  function clearNew() {
    resetNew();
    touchDraft();
  }
  function clearFilters() { get('searchInput').value = ''; get('categoryFilterSelect').value = ''; }
  // 共有メニューから届いたURL・画像を新規投稿フォームに入れる。保存は本人が押す。
  function applyShared({ url, memo, category, file }) {
    if (url) get('postUrl').value = url;
    if (memo) get('memo').value = memo;
    if (category) get('category').value = category;
    if (file) chooseImage('main', file);
  }
  function renderDetail(recipe) {
    if (detailRecipe === recipe) return;
    detailRecipe = recipe;
    get('detailCategory').textContent = categoryLabel(recipe.category) || '未分類';
    get('detailMemo').textContent = recipe.memo || 'メモはありません。';
    renderThumbnail(get('detailImage'), recipe.thumbnail_url, recipe.category);
    for (const [id, url] of [['detailSource', safePostUrl(recipe.post_url)], ['detailImageLink', safeImageUrl(recipe.thumbnail_url, origin)]]) {
      get(id).hidden = !url;
      if (url) get(id).href = url;
      else get(id).removeAttribute('href');
    }
  }
  function openDetail(recipe) {
    detailTrigger = document.activeElement;
    renderDetail(recipe);
    get('detailModal').showModal();
    get('detailModal').querySelector('.modal-content').scrollTop = 0;
    document.body.classList.add('modal-open');
  }
  function closeDetail() {
    if (get('detailModal').open) get('detailModal').close();
    get('detailImage').replaceChildren();
    get('detailMemo').textContent = '';
    get('detailCategory').textContent = '';
    for (const id of ['detailSource', 'detailImageLink']) {
      get(id).removeAttribute('href');
      get(id).hidden = true;
    }
    detailRecipe = null;
    if (!get('editModal').open) document.body.classList.remove('modal-open');
    if (detailTrigger?.isConnected) detailTrigger.focus();
    detailTrigger = null;
  }
  function closeEdit() {
    releasePreview('modal');
    files.modal = null;
    get('modalImageInput').value = '';
    get('modalMemo').value = '';
    get('modalCategory').value = '';
    get('modalThumbnail').replaceChildren();
    const dialog = get('editModal');
    if (dialog.open) dialog.close();
    if (!get('detailModal').open) document.body.classList.remove('modal-open');
    if (editTrigger?.isConnected) editTrigger.focus();
    editTrigger = null;
  }
  function openEdit(recipe) {
    releasePreview('modal');
    files.modal = null;
    get('modalImageInput').value = '';
    get('modalMemo').value = recipe.memo;
    get('modalCategory').value = recipe.category;
    renderThumbnail(get('modalThumbnail'), recipe.thumbnail_url, recipe.category);
    editTrigger = document.activeElement;
    get('editModal').showModal();
    document.body.classList.add('modal-open');
    get('modalMemo').focus();
  }

  function setAuth(kind) {
    const messages = {
      checking: 'ログイン状態を確認しています…',
      'signed-out': 'ご本人のGoogleアカウントでログインしてください。',
      owner: 'ログイン中',
      denied: 'このアカウントでは利用できません。ログアウトして、ご本人のアカウントを選んでください。',
      unconfigured: 'ログイン設定の準備中です。現在は保存データへ接続していません。',
      error: 'アプリを読み込めませんでした。通信状態を確認してページを再読み込みしてください。'
    };
    get('authStatus').textContent = messages[kind];
    get('loginButton').hidden = kind !== 'signed-out';
    get('logoutButton').hidden = !['owner', 'denied'].includes(kind);
    get('appContent').hidden = kind !== 'owner';
  }

  function setBusy({ authorized, loaded, loading, savingNew, savingEdit, authBusy, actionsBusy }) {
    get('newFields').disabled = !authorized || !loaded || loading || savingNew;
    get('filterFields').disabled = !authorized || loading;
    get('modalFields').disabled = savingEdit;
    get('modalClose').disabled = savingEdit;
    get('saveNewButton').textContent = savingNew ? '保存中…' : '保存する';
    get('saveEditButton').textContent = savingEdit ? '保存中…' : '保存';
    get('loginButton').disabled = authBusy;
    get('logoutButton').disabled = authBusy || actionsBusy;
    get('newForm').setAttribute('aria-busy', String(savingNew));
    get('editForm').setAttribute('aria-busy', String(savingEdit));
  }

  function bind(nextActions) {
    actions = nextActions;
    for (const id of ['category', 'modalCategory', 'categoryFilterSelect']) {
      const select = get(id);
      for (const category of CATEGORIES) {
        const option = make('option', '', category.label);
        option.value = category.value;
        select.append(option);
      }
    }
    listen(get('loginButton'), 'click', () => act(actions.login));
    listen(get('logoutButton'), 'click', () => act(actions.logout));
    listen(get('newForm'), 'submit', event => { event.preventDefault(); act(actions.saveNew); });
    listen(get('clearFormButton'), 'click', actions.clearNew);
    listen(get('clearImageButton'), 'click', () => { clearImage(); touchDraft(); });
    for (const [id, type] of [['postUrl', 'input'], ['memo', 'input'], ['category', 'change']]) listen(get(id), type, touchDraft);
    listen(get('searchInput'), 'input', event => actions.search(event.target.value));
    listen(get('categoryFilterSelect'), 'change', event => actions.filter(event.target.value));
    listen(get('editForm'), 'submit', event => { event.preventDefault(); act(actions.saveEdit); });
    listen(get('modalClose'), 'click', actions.closeEdit);
    listen(get('cancelEditButton'), 'click', actions.closeEdit);
    listen(get('detailClose'), 'click', actions.closeDetail);
    listen(get('detailDone'), 'click', actions.closeDetail);
    listen(get('detailEdit'), 'click', () => { if (detailRecipe) actions.openEdit(detailRecipe.id); });
    listen(get('detailModal'), 'cancel', event => { event.preventDefault(); actions.closeDetail(); });
    listen(get('detailModal'), 'click', event => { if (event.target === get('detailModal')) actions.closeDetail(); });
    listen(document.defaultView, 'beforeunload', event => {
      if (actions.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; }
    });
    listen(get('editModal'), 'cancel', event => { event.preventDefault(); actions.closeEdit(); });
    listen(get('editModal'), 'click', event => { if (event.target === get('editModal')) actions.closeEdit(); });
    for (const [which, areaId, inputId, fieldsetId] of [['main', 'uploadArea', 'imageInput', 'newFields'], ['modal', 'modalUploadArea', 'modalImageInput', 'modalFields']]) {
      const area = get(areaId);
      const input = get(inputId);
      listen(area, 'click', () => input.click());
      listen(input, 'change', () => chooseImage(which, input.files?.[0]));
      listen(area, 'dragover', event => { event.preventDefault(); if (!get(fieldsetId).disabled) area.classList.add('dragover'); });
      listen(area, 'dragleave', () => area.classList.remove('dragover'));
      listen(area, 'drop', event => {
        event.preventDefault();
        area.classList.remove('dragover');
        if (!get(fieldsetId).disabled) chooseImage(which, event.dataTransfer?.files?.[0]);
      });
    }
  }

  function reset() {
    clearTimeout(toastTimer);
    get('customToast').classList.remove('show');
    get('customToast').textContent = '';
    closeEdit();
    closeDetail();
    resetNew();
    clearFilters();
    cards.clear();
    get('recipesGrid').replaceChildren();
    get('recipeCount').textContent = '0件';
  }
  function destroy() { reset(); listeners.abort(); clearTimeout(toastTimer); }

  return {
    bind, setAuth, setBusy, renderList, notify, clearNew, clearFilters, applyShared, onDraftChange: listener => { draftListener = listener; }, openEdit, closeEdit, openDetail, closeDetail, renderDetail, reset, destroy, confirmDelete, confirmDiscard,
    readNew: () => ({ url: get('postUrl').value, memo: get('memo').value, category: get('category').value, file: files.main }),
    readEdit: () => ({ memo: get('modalMemo').value, category: get('modalCategory').value, file: files.modal })
  };
}
