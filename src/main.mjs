import { ownerUid } from './config.mjs';
import { createController } from './controller.mjs';
import { takeSharedInbox } from './share.mjs';
import { createView } from './view.mjs';

// 共有メニューから開かれたときは、保存された内容を読み出してアドレスの ?share を消す。
async function readSharedContent() {
  if (!new URLSearchParams(location.search).has('share') || !('caches' in window)) return null;
  history.replaceState(null, '', location.pathname);
  try { return await takeSharedInbox(caches, location.href); } catch { return null; }
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
    window.addEventListener('pagehide', event => { if (!event.persisted) controller.dispose(); });
  } catch {
    view.reset();
    view.setAuth('error');
  }
}
