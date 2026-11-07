// Swim Kit service worker
// 方針:ネットワーク優先。つながれば常に最新版を取得してキャッシュを更新し、
// オフラインや電波が弱いとき(3.5秒以内に応答がないとき)は前回のキャッシュで起動する。
// ※中身を大きく変えたときは CACHE の番号を上げると古いキャッシュが掃除される。
const CACHE = 'swim-kit-v1';
const CORE = ['./', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png'];
const NAV_TIMEOUT = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    // 1つ失敗しても全体を止めない
    Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Webフォント本体は不変なのでキャッシュ優先
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => put(req, r))));
    return;
  }
  // 同じサイトのファイルとフォントのCSSだけ扱う(それ以外はブラウザに任せる)
  if (url.origin !== self.location.origin && url.hostname !== 'fonts.googleapis.com') return;

  const network = fetch(req).then(r => put(req, r));
  const fallback = () => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));

  if (req.mode === 'navigate') {
    // ページ本体:ネットワーク優先。ただし応答が遅すぎるときはキャッシュで先に起動
    e.respondWith(new Promise(resolve => {
      let done = false;
      const finish = r => { if (!done && r) { done = true; resolve(r); } };
      const timer = setTimeout(() => fallback().then(finish), NAV_TIMEOUT);
      network.then(r => { clearTimeout(timer); finish(r); })
        .catch(() => { clearTimeout(timer); fallback().then(r => r ? finish(r) : finish(Response.error())); });
    }));
    return;
  }
  // その他:ネットワーク優先 → 失敗したらキャッシュ
  e.respondWith(network.catch(() => fallback().then(r => r || Response.error())));
});
