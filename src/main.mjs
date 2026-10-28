import { ownerUid } from './config.mjs';
import { createController } from './controller.mjs';
import { createView } from './view.mjs';

const view = createView(document);
if (!ownerUid || ownerUid === 'REPLACE_WITH_OWNER_UID') {
  // 設定前はFirebase SDK自体を読み込まない。公開設定の不足を隠してデータ取得しない。
  view.setAuth('unconfigured');
} else {
  view.setAuth('checking');
  try {
    const { createBackend } = await import('./backend.mjs');
    const controller = createController({ backend: createBackend(), view, ownerUid });
    controller.start();
    window.addEventListener('pagehide', event => { if (!event.persisted) controller.dispose(); });
  } catch {
    view.reset();
    view.setAuth('error');
  }
}
