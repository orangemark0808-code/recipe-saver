// 画像から文字を読み取る（Tesseract.js。画像は端末の外に送らず、ブラウザの中で処理する）。
// 部品と日本語データは、初めて使うときだけCDNから読み込み、以降は端末に保存される。
const VERSION = '5.1.1';
const BASE = `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSION}/dist`;
const CORE_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${VERSION}`;
// 日本語データ（整数版・約2MB）。
const LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int';
// 読み込んだ部品が改ざんされていないことの確認用の値。
const SCRIPT_INTEGRITY = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
const LOAD_ERROR = '文字認識の部品を読み込めませんでした。通信状態を確認して、もう一度お試しください。';

let loading = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}/tesseract.min.js`;
    script.integrity = SCRIPT_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error(LOAD_ERROR));
    script.onerror = () => { loading = null; script.remove(); reject(new Error(LOAD_ERROR)); };
    document.head.append(script);
  });
  return loading;
}

// 保存済みの画像（URL）は、取得して読み取れる形にする。
async function fetchImage(url) {
  try {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('status');
    return await response.blob();
  } catch { throw new Error('保存済みの画像を取得できませんでした。通信状態を確認して、もう一度お試しください。'); }
}

// 進捗は { stage: 'prepare' | 'read', progress: 0〜1 } で知らせる。
export function createOcr({ loadLibrary = loadTesseract } = {}) {
  return {
    async recognize(source, onProgress = () => {}) {
      const Tesseract = await loadLibrary();
      const image = typeof source === 'string' ? await fetchImage(source) : source;
      onProgress({ stage: 'prepare', progress: 0 });
      const worker = await Tesseract.createWorker('jpn', 1, {
        workerPath: `${BASE}/worker.min.js`,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        logger: message => {
          if (message.status === 'recognizing text') onProgress({ stage: 'read', progress: message.progress });
          else if (typeof message.progress === 'number') onProgress({ stage: 'prepare', progress: message.progress });
        }
      });
      try {
        const { data } = await worker.recognize(image);
        return data.text;
      } finally { await worker.terminate(); }
    }
  };
}
