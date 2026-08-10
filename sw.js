/* 上海迪士尼 2026 — Service Worker
 *
 * 這支檔案的唯一任務：讓你人在上海、連不上 Google 的時候，
 * 打開這個網站還看得到行程。
 *
 * 策略分兩種：
 *   1. 網站本身的檔案（html / js / 圖示）→ 快取優先（cache-first）
 *      開了就用快取裡的，速度快、沒網路也能開，
 *      同時在背景偷偷更新，下次開就是新版。
 *   2. Apps Script（Google 試算表資料）→ 完全不快取
 *      資料一定要即時，寧可失敗也不要給你看到過期的行程。
 *      （資料的離線備份是由 index.html 自己存在 localStorage，
 *        不歸這裡管。）
 *
 * 改版時把 VERSION 加一，舊快取會自動清掉。
 */

var VERSION = 'v5';
var CACHE = 'sh-disney-' + VERSION;

/* 網站外殼：這幾個檔案存下來，離線就能開 */
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

/* ---------- 安裝：把外殼抓下來 ---------- */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 一個一個抓，某個檔案掛掉不會害整包安裝失敗 */
      return Promise.all(SHELL.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------- 啟用：清掉舊版快取 ---------- */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf('sh-disney-') === 0) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- 攔截請求 ---------- */
self.addEventListener('fetch', function (e) {
  var req = e.request;

  /* 只管 GET，POST（存資料）一律放行 */
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Google Apps Script 的資料一律走網路，絕不快取 —
     行程資料寧可拿不到，也不要拿到舊的 */
  if (url.hostname.indexOf('script.google') > -1 ||
      url.hostname.indexOf('googleusercontent') > -1) {
    return;
  }

  /* 其他網域（外部連結、地圖等）不插手 */
  if (url.origin !== self.location.origin) return;

  /* 導覽請求（直接打網址、從桌面圖示開）
     → 先試網路，失敗就回快取的 index.html */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* 一般靜態檔 → 快取優先，背景更新 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return hit;
      });
      return hit || live;
    })
  );
});

/* ---------- 讓網頁可以叫它立刻更新 ---------- */
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
