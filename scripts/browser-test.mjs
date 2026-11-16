import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

// Exercise the real rendered site and its download, not a simulated DOM.
const output = path.resolve('qa-results');
await fs.mkdir(output, { recursive: true });
const root = path.resolve('docs');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(await fs.readFile(filename));
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const report = { generated_at: new Date().toISOString(), checks: [], failures: [] };
const check = async (name, operation) => {
  try { const result = await operation(); report.checks.push({ name, result: result ?? 'pass' }); console.log('PASS:', name, result ?? ''); }
  catch (error) { report.failures.push({ name, message: error.message }); console.error('FAIL:', name, error.message); }
};
const format = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
const current = parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
const shift = (month, offset) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const previous = shift(current, -1);
const average = rows => rows.reduce((sum, row) => sum + row[1], 0) / rows.length;

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Jakarta', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#latestValue')?.textContent !== '—');
  const data = JSON.parse(await fs.readFile('docs/data/jisdor.json', 'utf8'));
  report.latest = data.rows.at(-1);
  await check('Previous month is the default in Jakarta time', async () => {
    assert.equal(await page.locator('#fromMonth').inputValue(), previous);
    assert.equal(await page.locator('#toMonth').inputValue(), previous);
  });
  await check('Monthly mean matches every published daily observation', async () => {
    const rows = data.rows.filter(r => r[0].startsWith(previous));
    assert.equal(await page.locator('#avgValue').innerText(), format.format(average(rows)));
    return { month: previous, observations: rows.length, average: average(rows) };
  });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 393, 873], ['small-mobile', 320, 740], ['landscape', 873, 393]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
    await check(label + ': page has no horizontal overflow', async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('Chart tooltip uses visible HTML content', async () => {
    const target = page.locator('#trendChart rect[pointer-events="all"]');
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.locator('#chartTooltip').evaluate(e => e.classList.contains('hidden')), false);
    assert.equal(await page.locator('#chartTooltip b').evaluate(e => e.namespaceURI), 'http://www.w3.org/1999/xhtml');
  });
  await page.mouse.move(0, 0);
  await page.locator('[data-preset="current"]').click();
  await check('Unfinished current month shows a persistent warning', async () => {
    assert.ok(await page.locator('#periodWarning').isVisible());
  });
  await page.locator('#fromMonth').fill(shift(current, -2));
  await page.locator('#fromMonth').dispatchEvent('change');
  await page.locator('#toMonth').fill(previous);
  await page.locator('#toMonth').dispatchEvent('change');
  await check('Two-month mean is based on days, not an average of monthly means', async () => {
    const rows = data.rows.filter(r => r[0].slice(0, 7) >= shift(current, -2) && r[0].slice(0, 7) <= previous);
    assert.equal(await page.locator('#avgValue').innerText(), format.format(average(rows)));
    return { observations: rows.length, average: average(rows) };
  });
  await check('Excel download is a real XLSX ZIP archive', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportButton').click();
    const download = await downloadPromise;
    const filename = path.join(output, download.suggestedFilename());
    await download.saveAs(filename);
    const bytes = await fs.readFile(filename);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    return { file: download.suggestedFilename(), bytes: bytes.length };
  });
  await page.locator('#fromMonth').fill(current);
  await page.locator('#fromMonth').dispatchEvent('change');
  await check('Invalid ranges clear ALL summaries and disable export', async () => {
    assert.ok(await page.locator('#rangeError').isVisible());
    assert.ok(await page.locator('#exportButton').isDisabled());
    assert.equal(await page.locator('#avgValue').innerText(), '—');
    assert.equal(await page.locator('#breakdownAverage').innerText(), '—');
  });
  await page.locator('[data-preset="previous"]').click();
  await check('Date sorting and table pagination respond correctly', async () => {
    const first = await page.locator('#rateTable tr').first().innerText();
    await page.locator('#sortDateButton').click();
    assert.notEqual(await page.locator('#rateTable tr').first().innerText(), first);
    if (await page.locator('#nextPage').isEnabled()) {
      await page.locator('#nextPage').click();
      assert.match(await page.locator('#paginationLabel').innerText(), /16/);
    }
  });
  await check('No uncaught browser JavaScript errors', async () => assert.deepEqual(errors, []));
  await context.close();

  if (process.env.LIVE_URL) {
    await check('Public GitHub Pages URL serves the working dashboard', async () => {
      const live = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Jakarta' });
      try {
        const tab = await live.newPage();
        const response = await tab.goto(process.env.LIVE_URL + '?qa=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
        assert.equal(response.status(), 200);
        await tab.locator('#latestValue').waitFor({ state: 'visible', timeout: 15000 });
        await tab.waitForFunction(() => document.querySelector('#latestValue')?.textContent !== '—', { timeout: 15000 });
        await tab.screenshot({ path: path.join(output, 'live-desktop.png'), fullPage: true });
        const result = { url: tab.url(), latest: await tab.locator('#latestValue').innerText(), date: await tab.locator('#latestDate').innerText() };
        report.live = result;
        return result;
      } finally { await live.close(); }
    });
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.failures.length) process.exitCode = 1;
