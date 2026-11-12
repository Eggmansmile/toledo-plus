/* Toledo+ — TP.kaltura (FORK ONLY, not for upstream): download the mp4 of a Kaltura lecture recording.
   An Ultra item of type resource/x-bb-blti-link whose url is a KAF link opens the video through an LTI 1.3 launch. We replay it
   through the background relay with the student's own sessions (read-only; the only POST is the launch form Ultra itself hands out):
     1. GET  ultra …/blti/launchLink            → (redirects via KAF oidc-init and developer.blackboard.com) the auto-submit form
     2. POST KAF /hosted/index/oauth2-launch    → KAF page that redirects (JS) to media-redirect
     3. GET  KAF media-redirect                 → page with partnerId + a Kaltura session (ks) in its embed config
     4. GET  cdnapisec …/playManifest/…/applehttp → HLS master playlist: one line per flavor id + bandwidth
     5. the browser opens …/playManifest/…/flavorIds/<best>/format/download → 302 to a signed CDN mp4 with Content-Disposition:
        attachment, so the file streams to disk (no blob; recordings are 100 MB – several GB). The file name is Kaltura's own.
   Never throws: false = failed (DRM / no mp4 flavor / signed out / host changed), the caller falls back to opening the item in Ultra. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const KAF = 'https://kaltura-kaf.edu.kuleuven.cloud';
  const CDN = 'https://cdnapisec.kaltura.com';
  const ENTRY = /^https:\/\/kaltura-kaf\.edu\.kuleuven\.cloud\/browseandembed\/index\/media\/entryid\/(\d+_[a-z0-9]+)\//i;

  /** Kaltura entry id of an Ultra content node, or null when it is not a KAF video link. */
  function entryId(node) {
    const h = node && node.contentHandler;
    const m = h && h.id === 'resource/x-bb-blti-link' && ENTRY.exec(String(h.url || ''));
    return m ? m[1] : null;
  }

  /** Steps 1-4 → {url} of the best mp4 flavor (shortcut: highest HLS bandwidth = best quality that exists as a plain mp4). */
  async function resolve(cid, contentId, entry) {
    const text = (u, o) => TP.net.text(u, Object.assign({ relay: true }, o));
    const launch = await text(`${ULTRA}/webapps/blackboard/execute/blti/launchLink?course_id=${encodeURIComponent(cid)}&content_id=${encodeURIComponent(contentId)}`);
    const form = new DOMParser().parseFromString(launch, 'text/html').querySelector('form[name="bltiLaunchForm"]');
    if (!form || form.getAttribute('action') !== `${KAF}/hosted/index/oauth2-launch`) throw new Error('no launch form');
    const body = new URLSearchParams();
    for (const i of form.querySelectorAll('input[name]')) body.append(i.name, i.value);
    const landing = await text(`${KAF}/hosted/index/oauth2-launch`, { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const next = /window\.location\.href = ("[^"]+")/.exec(landing);
    const nextUrl = next && JSON.parse(next[1]);
    if (!nextUrl || !nextUrl.startsWith(KAF + '/')) throw new Error('no media redirect');
    const page = await text(nextUrl);
    const pid = (/"partnerId":(\d+)/.exec(page) || [])[1];
    const ks = (/"ks":"([^"]+)"/.exec(page) || [])[1];
    if (!pid || !ks) throw new Error('no session');
    const base = `${CDN}/p/${pid}/sp/${pid}00/playManifest/entryId/${entry}`;
    const hls = await text(`${base}/format/applehttp/protocol/https/a.m3u8?ks=${encodeURIComponent(ks)}`);
    let best = null;
    const re = /BANDWIDTH=(\d+)[^\n]*\n\S*\/flavorId\/([\w]+)\//g;
    for (let m; (m = re.exec(hls));) if (!best || +m[1] > best.bw) best = { bw: +m[1], id: m[2] };
    if (!best) throw new Error('no flavor');
    return { url: `${base}/flavorIds/${best.id}/format/download/protocol/https?ks=${encodeURIComponent(ks)}` };
  }

  /** → true (download started) | false. */
  async function download(cid, contentId, entry) {
    try {
      const { url } = await resolve(cid, contentId, entry);
      const a = document.createElement('a');
      a.href = url; a.rel = 'noopener'; a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      try { console.debug('[Toledo+] video download failed', e && e.message); } catch (_) { /* noop */ }
      return false;
    }
  }

  TP.kaltura = { entryId, download, _resolve: resolve };
})();
