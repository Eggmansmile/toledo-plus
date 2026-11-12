'use strict';
// Fork-only: the download button on a Kaltura (KAF) lecture item runs the LTI chain through the relay and saves the best mp4 flavor.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, waitFor, COURSE_URL } = require('../helpers/launch');

describe('kaltura video download (fork)', () => {
  let h; let page;
  const ID = '_5020_1';
  const btn = () => page.locator(`#tplus-root [data-action="download"][data-id="${ID}"]`).first();
  before(async () => {
    h = await launch(); page = h.page;
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction((id) => !!document.querySelector('#tplus-root').shadowRoot.querySelector(`[data-action="download"][data-id="${id}"]`), ID, { timeout: 15000 });
    await waitForIdle(page);
    await waitForQuiet(page);
  });
  after(async () => { await h?.close(); });

  it('launches via the relay and downloads the highest-bandwidth flavor', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), btn().click()]);
    assert.equal(dl.suggestedFilename(), 'Lecture_mock.mp4');
    assert.deepEqual(h.rec.kaltura.calls, ['launchLink', 'launch', 'media', 'hls', 'download:1_high']);
    assert.deepEqual(h.rec.foreign, [], 'no foreign hosts');
  });

  it('no mp4 flavor (DRM): falls back to opening the item in Ultra', async () => {
    h.rec.kaltura.mode = 'drm'; h.rec.kaltura.calls.length = 0;
    const popup = page.context().waitForEvent('page', { timeout: 10000 });
    await btn().click();
    const p = await popup;
    assert.ok(await waitFor(() => h.rec.kaltura.calls.includes('hls')));
    assert.ok(!h.rec.kaltura.calls.some((c) => c.startsWith('download')), 'nothing downloaded');
    assert.ok(p.url().includes(`contentId=${ID}`) || (await waitFor(() => p.url().includes(`contentId=${ID}`))), 'item opened in Ultra');
    assert.deepEqual(h.rec.foreign, []);
  });
});
