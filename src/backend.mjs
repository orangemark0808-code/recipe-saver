import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig, ownerUid, cloudinary } from './config.mjs';
import { cropScreenshotUrl, normalizeRecipe, safeImageUrl, validateImage } from './core.mjs';

export function createBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const records = collection(db, 'insta_bookmarks');
  // カテゴリの設定（名前・順番）。PCとスマホで同じ内容を使う。
  const categorySettings = doc(db, 'insta_settings', 'categories');
  function requireOwner() {
    if (!ownerUid || auth.currentUser?.uid !== ownerUid) throw new Error('ご本人のアカウントでログインしてください。');
  }
  return {
    watchAuth: (callback, onError) => onAuthStateChanged(auth, callback, onError),
    login: () => signInWithPopup(auth, new GoogleAuthProvider()),
    logout: () => signOut(auth),
    async list() {
      requireOwner();
      const result = await getDocs(query(records, orderBy('created_at', 'desc')));
      return result.docs.map(item => normalizeRecipe(item.id, item.data()));
    },
    async loadCategories() {
      requireOwner();
      const result = await getDoc(categorySettings);
      return result.exists() ? result.data() : null;
    },
    async saveCategories(items) {
      requireOwner();
      try { await setDoc(categorySettings, { items, updated_at: new Date().toISOString() }); }
      catch { throw new Error('カテゴリを保存できませんでした。通信状態とFirestoreのルール設定をご確認ください。'); }
    },
    async create(data) {
      requireOwner();
      const result = await addDoc(records, data);
      return result.id;
    },
    async update(id, data) {
      requireOwner();
      if (!id) throw new Error('編集対象が見つかりません。');
      await updateDoc(doc(records, id), data);
    },
    async remove(id) {
      requireOwner();
      if (!id) throw new Error('削除対象が見つかりません。');
      await deleteDoc(doc(records, id));
    },
    async upload(file) {
      requireOwner();
      validateImage(file);
      const form = new FormData();
      form.append('file', file);
      form.append('upload_preset', cloudinary.uploadPreset);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`, {
          method: 'POST', body: form, signal: controller.signal
        });
        if (!response.ok) throw new Error('画像アップロードに失敗しました。もう一度お試しください。');
        const data = await response.json();
        const url = safeImageUrl(data.secure_url);
        if (!url) throw new Error('画像の保存先を確認できませんでした。');
        requireOwner();
        // 縦長のスクショは上下の余白を自動で切る。
        return cropScreenshotUrl(url, data.width, data.height);
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('画像アップロードが時間切れになりました。もう一度お試しください。');
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
}
