import { ownerUid } from './config.mjs';
import { createController } from './controller.mjs';
import { clearDraft, loadDraft, saveDraft, saveDraftImage } from './share.mjs';
import { createView } from './view.mjs';

// 共有メニューから開かれたときは、保存されている下書きを読み出してアドレスの ?share を消す。
async function readSharedContent() {
  if (!new URLSearchParams(location.search).has('share') || !('caches' in window)) return null;
  history.replaceState(null, '', location.pathname);
  try { return await loadDraft(caches, location.href); } catch { return null; }
}
// 入力中の内容を下書きとして自動保存する。次の共有（URL→スクショなど）で合体させるため。
// 空になったら下書きも消す。保存・クリア・取り消しも入力欄の変化として同じ道を通る。
function watchDraft(view) {
  if (!('caches' in window)) return;
  let timer;
  let savedFile = null;
  async function write() {
    clearTimeout(timer);
    const input = view.readNew();
    try {
      if (!input.url && !input.memo && !input.category && !input.file) { savedFile = null; await clearDraft(caches, location.href); return; }
      await saveDraft(caches, location.href, input);
      if (input.file !== savedFile) { savedFile = input.file; await saveDraftImage(caches, location.href, input.file); }
    } catch {}
  }
  view.onDraftChange(() => { clearTimeout(timer); timer = setTimeout(write, 300); });
  // 他のアプリへ切り替える直前に、待たずに保存する。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) void write(); });
  window.addEventListener('pagehide', () => { if (timer) void write(); });
}
// 共有メニューの受け口（service worker）。登録に失敗しても通常の利用には影響しない。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { type: 'module' }).catch(() => {});
}

const view = createView(document);
if (!ownerUid || ownerUid === 'REPLACE_WITH_OWNER_UID') {
  // 設定前はFirebase SDK自体を読み込まない。公開設定の不足を隠してデータ取得しない。
  view.setAuth('unconfigured');
} else {
  view.setAuth('checking');
  try {
    const { createBackend } = await import('./backend.mjs');
    const controller = createController({ backend: createBackend(), view, ownerUid });
    controller.setShared(await readSharedContent());
    controller.start();
    watchDraft(view);
    window.addEventListener('pagehide', event => { if (!event.persisted) controller.dispose(); });
  } catch {
    view.reset();
    view.setAuth('error');
  }
}
