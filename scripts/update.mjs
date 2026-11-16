#!/usr/bin/env node
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FILE = new URL('../docs/data/jisdor.json', import.meta.url);
const BI_URL = 'https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursJisdor3';
const MIRROR_URL = 'https://raw.githubusercontent.com/risan/reksadana-id/main/data/macro/usd-idr.csv';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const validRow = row => {
  if (!Array.isArray(row) || row.length !== 2) return false;
  const [date, value] = row;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 1000 || value >= 100000) return false;
  const parsed = new Date(date + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
function todayInJakarta() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const field = key => parts.find(part => part.type === key).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
function parseBiXml(xml) {
  return [...xml.matchAll(/<Table(?:\s[^>]*)?>([\s\S]*?)<\/Table>/gi)].map(match => {
    const field = name => match[1].match(new RegExp(`<${name}>([^<]+)</${name}>`, 'i'))?.[1].trim();
    return [field('tgl_subkursasing')?.slice(0, 10) ?? '', Number(field('jual_subkursasing'))];
  }).filter(validRow);
}
function parseMirror(csv) {
  return csv.split(/\r?\n/).slice(1).map(line => { const [date, rate] = line.trim().split(','); return [date, Number(rate)]; }).filter(validRow);
}
async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': 'Mozilla/5.0 JisdorDashboard/1.1', Accept: 'application/xml,text/plain,*/*', ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.text();
}
async function run() {
  const data = JSON.parse(await fs.readFile(FILE, 'utf8'));
  if (data.schema !== 1 || !Array.isArray(data.rows) || !data.rows.length || !data.rows.every(validRow)) throw new Error('Stored dataset failed validation; leaving it unchanged');
  const today = todayInJakarta();
  const recent = new Date(today + 'T00:00:00Z'); recent.setUTCDate(recent.getUTCDate() - 95);
  const lastKnown = [...data.rows].sort((a, b) => a[0].localeCompare(b[0])).at(-1)[0];
  const catchUp = new Date(lastKnown + 'T00:00:00Z'); catchUp.setUTCDate(catchUp.getUTCDate() - 7);
  // Catch up after an extended outage, and re-read at least 95 days to pick up BI revisions.
  const startDate = new Date(Math.min(recent.getTime(), catchUp.getTime())).toISOString().slice(0, 10);
  const byDate = new Map(data.rows);
  let source = 'snapshot', downloaded = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const body = new URLSearchParams({ mts: 'USD', startDate, endDate: today });
      downloaded = parseBiXml(await fetchText(BI_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).filter(([date]) => date >= startDate && date <= today);
      if (!downloaded.length) throw new Error('No valid observations in the requested BI date range');
      source = 'BI'; break;
    } catch (error) { console.warn(`BI attempt ${attempt}/2: ${error.message}`); if (attempt === 1) await sleep(1700); }
  }
  if (!downloaded.length) {
    try {
      downloaded = parseMirror(await fetchText(MIRROR_URL)).filter(([date]) => date <= today);
      if (!downloaded.length) throw new Error('No valid mirror observations');
      source = 'mirror'; data.last_mirror_sync = new Date().toISOString();
      console.warn('Official BI service unavailable; using a clearly labelled BI-derived mirror.');
    } catch (error) { console.warn(`Mirror: ${error.message}`); }
  }
  let added = 0, corrected = 0;
  for (const [date, rate] of downloaded) {
    if (!byDate.has(date)) added++;
    else if (source === 'BI' && byDate.get(date) !== rate) corrected++;
    // A mirror can fill gaps but must never overwrite an existing BI value.
    if (source === 'BI' || !byDate.has(date)) byDate.set(date, rate);
  }
  const rows = [...byDate].sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length < data.rows.length) throw new Error('Refusing to discard historical observations');
  const now = new Date().toISOString();
  if (source === 'BI') data.last_bi_sync = now;
  data.last_attempt = now; data.last_source = source; data.rows = rows;
  const temporary = new URL('../docs/data/jisdor.json.tmp', import.meta.url);
  await fs.writeFile(temporary, JSON.stringify(data) + '\n');
  await fs.rename(temporary, FILE);
  console.log(`Source: ${source}; added ${added}, revised ${corrected}; ${rows.length} observations; latest ${rows.at(-1)[0]} = ${rows.at(-1)[1]}.`);
  if (source === 'snapshot') console.warn('Refresh failed. Existing data retained; the website will display a persistent warning.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => { console.error(error); process.exitCode = 1; });
export { parseBiXml, parseMirror, validRow };
