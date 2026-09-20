const CACHE_NAME = "draft-board-shell-v2";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch("/");
  const html = await indexResponse.clone().text();
  await cache.put("/", indexResponse);

  const assetUrls = new Set(SHELL_URLS.slice(1));
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assetUrls.add(match[1]);
  await cache.addAll([...assetUrls]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      })
      .catch(async () => {
        // Vite 静态资源带 Vary: Origin；离线导航产生的子资源请求头可能不同，
        // 但同源、内容寻址的构建产物仍是同一个文件，可安全忽略 Vary 匹配。
        const cached = await caches.match(request, { ignoreVary: true });
        if (cached) return cached;
        if (request.mode === "navigate") return (await caches.match("/")) || Response.error();
        return Response.error();
      }),
  );
});
