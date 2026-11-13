#!/usr/bin/env node
/**
 * Update the committed JISDOR dataset from Bank Indonesia's official historical service.
 * When BI is unavailable, a publicly readable BI-derived historical mirror is used
 * to add missing observations (existing official values are never overwritten).
 *
 * No third-party packages; intended for GitHub Actions Node 22.
 */
import fs from 'node:fs/promises';

const FILE = new URL('../docs/data/jisdor.json', import.meta.url);
const BI_URL = 'https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursJisdor3';
const MIRROR_URL = 'https://raw.githubusercontent.com/risan/reksadana-id/main/data/macro/usd-idr.csv';
const fromRows = (rows) => new Map(rows);
const todayInJakarta = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const field = (key) => parts.find((part) => part.type === key).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const validRow = ([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 1000 && value < 100000;

function parseBiXml(xml) {
  const rows = [...xml.matchAll(/<Table(?:\s[^>]*)?>([\s\S]*?)<\/Table>/gi)].map((match) => {
    const field = (name) => match[1].match(new RegExp(`<${name}>([^<]+)</${name}>`, 'i'))?.[1].trim();
    return [field('tgl_subkursasing')?.slice(0, 10) ?? '', Number(field('jual_subkursasing'))];
  });
  return rows.filter(validRow);
}

function parseMirror(csv) {
  return csv.split(/\r?\n/).slice(1).map((line) => {
    const [date, rate] = line.trim().split(',');
    return [date, Number(rate)];
  }).filter(validRow);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': 'Mozilla/5.0 JisdorDashboard/1.0', Accept: 'application/xml,text/plain,*/*', ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.text();
}

async function fetchFromBi(startDate, endDate) {
  const params = new URLSearchParams({ mts: 'USD', startDate, endDate });
  const xml = await fetchText(BI_URL, { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const rows = parseBiXml(xml);
  if (!rows.length) throw new Error('The BI service response contained no valid JISDOR rows');
  return rows;
}

async function run() {
  const data = JSON.parse(await fs.readFile(FILE, 'utf8'));
  if (data.schema !== 1 || !Array.isArray(data.rows) || data.rows.length < 100) throw new Error('Stored dataset failed validation');
  const today = todayInJakarta();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 95);
  const startDate = start.toISOString().slice(0, 10);
  const byDate = fromRows(data.rows);
  let source = '';
  let downloaded = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      downloaded = await fetchFromBi(startDate, today);
      source = 'BI';
      break;
    } catch (error) {
      console.warn(`BI request ${attempt}/2 failed: ${error.message}`);
      if (attempt !== 2) await sleep(1700);
    }
  }

  if (!downloaded.length) {
    try {
      downloaded = parseMirror(await fetchText(MIRROR_URL));
      if (!downloaded.length) throw new Error('Mirror response had no valid observations');
      source = 'historical mirror';
      data.last_mirror_sync = new Date().toISOString();
      console.warn('Using BI-derived historical mirror because the official service is unavailable.');
    } catch (error) {
      console.warn(`Mirror request failed: ${error.message}`);
    }
  }

  const latestKnown = data.rows.at(-1)?.[0] || '';
  let added = 0, corrected = 0;
  for (const [date, rate] of downloaded) {
    if (date > today || !validRow([date, rate])) continue;
    if (!byDate.has(date)) added++;
    else if (source === 'BI' && byDate.get(date) !== rate) corrected++;
    if (source === 'BI' || !byDate.has(date)) byDate.set(date, rate);
  }
  const rows = [...byDate.entries()].filter(validRow).sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length < data.rows.length) throw new Error('Update would discard historical observations');
  if (source === 'BI') data.last_bi_sync = new Date().toISOString();
  data.last_attempt = new Date().toISOString();
  data.rows = rows;
  await fs.writeFile(FILE, JSON.stringify(data) + '\n');
  console.log(`Source: ${source || 'existing verified snapshot'}; added ${added}, revised ${corrected}; total ${rows.length}; previous latest ${latestKnown}; latest ${rows.at(-1)[0]}.`);
  if (!source) console.warn('New rates could not be retrieved; preserving all existing data and date metadata.');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run().catch((error) => { console.error(error); process.exitCode = 1; });
}

export { parseBiXml, parseMirror, validRow };
