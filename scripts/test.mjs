#!/usr/bin/env node
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseBiXml, parseMirror } from './update.mjs';

const dataset = JSON.parse(await fs.readFile(new URL('../docs/data/jisdor.json', import.meta.url), 'utf8'));
assert.equal(dataset.schema, 1);
assert.equal(dataset.pair, 'USD/IDR');
assert.ok(dataset.rows.length >= 3200);
const byDate = new Map(dataset.rows);
assert.equal(byDate.size, dataset.rows.length, 'No duplicate dates');
assert.equal(byDate.get('2026-10-30'), 18138);
assert.equal(byDate.get('2026-11-12'), 18241);
for (let i = 0; i < dataset.rows.length; i++) {
  const [date, rate] = dataset.rows[i];
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(rate) && rate > 1000 && rate < 100000);
  if (i > 0) assert.ok(date > dataset.rows[i - 1][0], 'Chronological sorting');
}
const oct = dataset.rows.filter(([date]) => date.startsWith('2026-10'));
assert.equal(oct.length, 22);
const mean = oct.reduce((sum, [, rate]) => sum + rate, 0) / oct.length;
assert.ok(Math.abs(mean - 17995.68181818182) < .00001);

const fake = '<DataSet><Table><tgl_subkursasing>2026-11-12T00:00:00+07:00</tgl_subkursasing><jual_subkursasing>18241</jual_subkursasing></Table></DataSet>';
assert.deepEqual(parseBiXml(fake), [['2026-11-12', 18241]]);
assert.deepEqual(parseMirror('date,idr_per_usd\n2026-11-11,18154\n'), [['2026-11-11', 18154]]);

const xlsxSource = await fs.readFile(new URL('../docs/xlsx.js', import.meta.url), 'utf8');
const context = { window: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Date, Number, Math, String, Object, Array, Intl, Blob };
vm.runInNewContext(xlsxSource, context);
const bytes = context.window.JisdorXlsx.build({
  from: '2026-10', to: '2026-10',
  daily: [...oct].reverse().map(([date, rate]) => ({ date, rate, delta: 0 })),
  monthly: [{ month: '2026-10', count: 22, average: mean, min: 17880, max: 18183 }],
  average: mean, latest: '2026-11-12', incomplete: false,
});
assert.ok(bytes.length > 4000, 'XLSX output should contain populated worksheets');
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
let cursor = 0;
const entries = new Map();
while (cursor + 30 < bytes.length && dv.getUint32(cursor, true) === 0x04034b50) {
  const len = dv.getUint32(cursor + 18, true);
  const nameLen = dv.getUint16(cursor + 26, true);
  const extraLen = dv.getUint16(cursor + 28, true);
  const name = new TextDecoder().decode(bytes.slice(cursor + 30, cursor + 30 + nameLen));
  const start = cursor + 30 + nameLen + extraLen;
  entries.set(name, new TextDecoder().decode(bytes.slice(start, start + len)));
  cursor = start + len;
}
assert.ok(entries.has('[Content_Types].xml'));
assert.ok(entries.has('xl/workbook.xml'));
assert.ok(entries.get('xl/worksheets/sheet1.xml').includes('AVERAGE('), 'Formula-backed summary');
assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('t="n"><v>18138</v>'), 'Rate is numeric, not string');
assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('s="2" t="n"'), 'Dates are Excel serials');
assert.equal((entries.get('xl/worksheets/sheet2.xml').match(/<row r=/g) ?? []).length, 23);
console.log(`All checks passed. ${dataset.rows.length} historical observations, October average ${mean.toFixed(2)}, XLSX ${bytes.length} bytes.`);
