import { normalizeRecipe } from './core.mjs';

// このモジュールはローカル専用サーバーがbackend.mjsの代わりに配信する。
// Firebase、Cloudinary、既存データには接続しない。再読み込みで初期化される。
export function createBackend() {
  let listener;
  let records = [
    normalizeRecipe('preview-dessert', { category: 'dessert', memo: '確認用：米粉クッキー\n\n【材料】\n米粉120g・卵1個・きび糖40g・米油30g・牛乳20g\n\n【作り方】\n1. 卵ときび糖を混ぜます。\n2. 米油と牛乳を加えて混ぜます。\n3. 米粉を加え、ひとまとまりにします。\n4. 食べやすい大きさに成形します。\n5. オーブンで焼き、冷まして完成です。\n\n【メモ】\nこれは表示確認用の架空レシピです。\n全文の最後まで表示されることを確認します。', thumbnail_url: location.origin + '/__preview__/image.svg', post_url: 'https://www.instagram.com/p/preview/', favorite: false, saved_date: '2026/10/28', created_at: '2026-10-28T03:00:00Z' }),
    normalizeRecipe('preview-html', { category: 'main', memo: '<img src=x onerror="alert(1)"> は文字として表示', post_url: 'javascript:alert(1)', favorite: false, saved_date: '2026/10/28', created_at: '2026-10-28T02:00:00Z' }),
    normalizeRecipe('preview-broken-image', { category: 'ai', memo: '確認用：画像なしでも元のURLへ', post_url: 'https://www.instagram.com/p/preview-no-image/', thumbnail_url: location.origin + '/__preview__/missing.png', favorite: true, saved_date: '2026/10/28', created_at: '2026-10-28T01:00:00Z' })
  ];
  const copy = () => records.map(record => ({ ...record }));
  return {
    watchAuth(callback) { listener = callback; queueMicrotask(() => listener?.(null)); return () => { listener = null; }; },
    async login() { listener?.({ uid: 'local-preview-owner' }); },
    async logout() { listener?.(null); },
    async list() { return copy(); },
    async create(data) {
      const id = crypto.randomUUID();
      records.unshift(normalizeRecipe(id, data));
      return id;
    },
    async update(id, data) { records = records.map(record => record.id === id ? normalizeRecipe(id, { ...record, ...data }) : record); },
    async remove(id) { records = records.filter(record => record.id !== id); },
    async upload() {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return location.origin + '/__preview__/image.svg';
    }
  };
}
