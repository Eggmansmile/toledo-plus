'use strict';
// Fork-only mock of the Kaltura video chain (src/core/kaltura.js): Ultra LTI launchLink (already resolved to the auto-submit form,
// Playwright can't follow a mocked 3xx), KAF launch + media-redirect, Kaltura playManifest. Synthetic ids, no real token.
// rec.kaltura = { mode: 'ok' | 'drm' (no mp4 flavor), calls: ['launchLink', 'launch', 'media', 'hls', 'download:<flavor>'] }
const ULTRA = 'https://ultra.edu.kuleuven.cloud';
const KAF = 'https://kaltura-kaf.edu.kuleuven.cloud';
const CDN = 'https://cdnapisec.kaltura.com';
const html = (route, body) => route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body });

async function install(ctx, rec) {
  rec.kaltura = { mode: 'ok', calls: [] };
  const hit = (c) => rec.kaltura.calls.push(c);
  await ctx.route(`${ULTRA}/webapps/blackboard/execute/blti/launchLink**`, (route) => {
    hit('launchLink');
    return html(route, `<html><body><form method="POST" name="bltiLaunchForm" action="${KAF}/hosted/index/oauth2-launch"><input type="hidden" name="id_token" value="mock.id.token"><input type="hidden" name="state" value="mockstate"></form></body></html>`);
  });
  await ctx.route(`${KAF}/**`, (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (req.method() === 'POST' && u.pathname === '/hosted/index/oauth2-launch') {
      hit('launch');
      if (!/id_token=mock\.id\.token&state=mockstate/.test(req.postData() || '')) return route.fulfill({ status: 400, body: 'bad form' });
      return html(route, `<script>window.location.href = "https:\\/\\/kaltura-kaf.edu.kuleuven.cloud\\/browseandembed\\/index\\/media-redirect\\/entryid\\/1_mockentry";</script>`);
    }
    if (u.pathname.startsWith('/browseandembed/index/media-redirect/')) {
      hit('media');
      return html(route, '<script>var cfg = {"isKAF":true,"partnerId":1234567,"serviceUrl":"https:\\/\\/www.kaltura.com"}; var d = {"eventType":1,"partnerId":1234567,"ks":"mock-ks_123","x":1};</script>');
    }
    rec.unknown.push({ method: req.method(), url: req.url() });
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
  await ctx.route(`${CDN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('ks') !== 'mock-ks_123') return route.fulfill({ status: 403, body: 'ks' });
    if (u.pathname.includes('/format/applehttp/')) {
      hit('hls');
      const body = rec.kaltura.mode === 'drm' ? '#EXTM3U\n' : '#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=194571,RESOLUTION=640x360\nhttps://cfvod.example.invalid/scf/hls/p/1/sp/100/serveFlavor/entryId/1_mockentry/v/1/flavorId/1_low/name/a.mp4/index.m3u8?Policy=x\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=269902,RESOLUTION=960x540\nhttps://cfvod.example.invalid/scf/hls/p/1/sp/100/serveFlavor/entryId/1_mockentry/v/1/flavorId/1_high/name/a.mp4/index.m3u8?Policy=x\n';
      return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body });
    }
    const m = u.pathname.match(/\/flavorIds\/(\w+)\/format\/download\//);
    if (m) {
      hit('download:' + m[1]);
      return route.fulfill({ status: 200, headers: { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="Lecture_mock.mp4"' }, body: Buffer.from('\0\0\0 ftypisom') });
    }
    rec.unknown.push({ method: route.request().method(), url: u.href });
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
}
module.exports = { install };
