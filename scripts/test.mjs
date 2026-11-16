#!/usr/bin/env node
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseBiXml, parseMirror, validRow } from './update.mjs';

const dataset = JSON.parse(await fs.readFile(new URL('../docs/data/jisdor.json', import.meta.url), 'utf8'));
assert.equal(dataset.schema, 1);
assert.equal(dataset.pair, 'USD/IDR');
assert.ok(dataset.rows.length >= 3200, 'Expected the retained historical series');
assert.equal(new Map(dataset.rows).size, dataset.rows.length, 'No duplicate dates');
for (let i = 0; i < dataset.rows.length; i++) {
  assert.ok(validRow(dataset.rows[i]), 'Valid ISO calendar date and numeric rate');
  if (i) assert.ok(dataset.rows[i][0] > dataset.rows[i - 1][0], 'Chronological order');
}
assert.equal(validRow(['2026-02-30', 18000]), false);
assert.equal(validRow(['2026-11-12', '18241']), false);
assert.equal(validRow(['2026-11-12', NaN]), false);
const xml = '<DataSet><Table xmlns="test"><tgl_subkursasing>2026-11-12T00:00:00+07:00</tgl_subkursasing><jual_subkursasing>18241</jual_subkursasing></Table></DataSet>';
assert.deepEqual(parseBiXml(xml), [['2026-11-12', 18241]]);
assert.deepEqual(parseMirror('date,idr_per_usd\n2026-11-11,18154\ninvalid,0\n'), [['2026-11-11', 18154]]);
// Synthetic fixtures test the exporter without freezing real observations that BI may revise.
const daily = [
  { date: '2026-10-02', rate: 18000, delta: 1000 },
  { date: '2026-10-01', rate: 17000, delta: 1000 },
  { date: '2026-09-30', rate: 16000, delta: null },
];
const average = daily.reduce((sum, row) => sum + row.rate, 0) / daily.length;
assert.equal(average, 17000);
assert.notEqual(average, (17500 + 16000) / 2, 'Combined mean must weight daily observations equally');
const source = await fs.readFile(new URL('../docs/xlsx.js', import.meta.url), 'utf8');
const context = { window: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Date, Number, Math, String, Object, Array, Intl, Blob };
vm.runInNewContext(source, context);
const bytes = context.window.JisdorXlsx.build({
  from: '2026-09', to: '2026-10', daily,
  monthly: [
    { month: '2026-09', count: 1, average: 16000, min: 16000, max: 16000 },
    { month: '2026-10', count: 2, average: 17500, min: 17000, max: 18000 },
  ], average, latest: '2026-11-12', incomplete: false,
});
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const entries = new Map(); let cursor = 0;
while (cursor + 30 < bytes.length && view.getUint32(cursor, true) === 0x04034b50) {
  const length = view.getUint32(cursor + 18, true), nameLength = view.getUint16(cursor + 26, true), extraLength = view.getUint16(cursor + 28, true);
  const name = new TextDecoder().decode(bytes.slice(cursor + 30, cursor + 30 + nameLength));
  const start = cursor + 30 + nameLength + extraLength;
  entries.set(name, new TextDecoder().decode(bytes.slice(start, start + length)));
  cursor = start + length;
}
assert.ok(entries.has('[Content_Types].xml'));
assert.ok(entries.has('xl/workbook.xml'));
assert.ok(entries.get('xl/worksheets/sheet1.xml').includes("AVERAGE(&apos;Daily Rates&apos;!B2:B4)"));
assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('t="n"><v>18000</v>'));
assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('s="2" t="n"'));
assert.equal((entries.get('xl/worksheets/sheet2.xml').match(/<row r=/g) || []).length, 4);
console.log(`PASS: ${dataset.rows.length} historical observations; valid dates; parsers; daily-weighted mean; genuine XLSX numbers, dates and summary formula.`);
