(() => {
  'use strict';
  // Minimal, dependency-free OOXML spreadsheet writer. Numeric and date cells are typed, not strings.
  const encoder = new TextEncoder();
  const xmlEscape = (input) => String(input).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const excelDate = (iso) => (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
  const validNumber = (n) => typeof n === 'number' && Number.isFinite(n);
  const colName = (index) => { let s = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const str = (value, style = 0) => ({ type: 'str', value: String(value), style });
  const num = (value, style = 1, formula) => ({ type: 'num', value, style, formula });
  const date = (value) => ({ type: 'num', value: excelDate(value), style: 2 });

  function cellXml(ref, data) {
    if (!data || data.value === undefined || data.value === null || (data.type === 'num' && !validNumber(data.value))) return '';
    const style = data.style || 0;
    if (data.type === 'str') return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(data.value)}</t></is></c>`;
    if (data.formula) return `<c r="${ref}" s="${style}"><f>${xmlEscape(data.formula)}</f><v>${data.value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="n"><v>${data.value}</v></c>`;
  }

  function worksheet(rows, widths, filter = false, frozen = 0) {
    const dimensions = `A1:${colName(Math.max(1, widths.length))}${Math.max(rows.length, 1)}`;
    const sheetRows = rows.map((row, i) => `<row r="${i + 1}">${row.map((item, c) => cellXml(`${colName(c + 1)}${i + 1}`, item)).join('')}</row>`).join('');
    const columns = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    const freeze = frozen ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const autoFilter = filter && rows.length >= 2 ? `<autoFilter ref="${dimensions}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimensions}"/>${freeze}<sheetFormatPr defaultRowHeight="17"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${autoFilter}<pageMargins left="0.45" right="0.45" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts>
      <fonts count="4">
        <font><sz val="11"/><name val="Aptos"/><color rgb="FF26364A"/></font>
        <font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
        <font><b/><sz val="16"/><name val="Aptos Display"/><color rgb="FF1D3557"/></font>
        <font><b/><sz val="11"/><name val="Aptos"/><color rgb="FF2F61D6"/></font>
      </fonts>
      <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3355"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FF"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="7">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="164" fontId="3" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
        <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function add16(view, offset, n) { view.setUint16(offset, n, true); }
  function add32(view, offset, n) { view.setUint32(offset, n, true); }
  function concat(parts) { let length = 0; for (const part of parts) length += part.length; const result = new Uint8Array(length); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } return result; }
  function makeZip(files) {
    const locals = [], central = [];
    let offset = 0;
    for (const [filename, content] of Object.entries(files)) {
      const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      add32(l, 0, 0x04034B50); add16(l, 4, 20); add16(l, 6, 0x0800); add16(l, 8, 0);
      add16(l, 10, 0); add16(l, 12, 0x0021); add32(l, 14, crc); add32(l, 18, data.length); add32(l, 22, data.length);
      add16(l, 26, name.length); add16(l, 28, 0); local.set(name, 30);
      locals.push(local, data);
      const cd = new Uint8Array(46 + name.length), c = new DataView(cd.buffer);
      add32(c, 0, 0x02014B50); add16(c, 4, 20); add16(c, 6, 20); add16(c, 8, 0x0800); add16(c, 10, 0);
      add16(c, 12, 0); add16(c, 14, 0x0021); add32(c, 16, crc); add32(c, 20, data.length); add32(c, 24, data.length);
      add16(c, 28, name.length); add16(c, 30, 0); add16(c, 32, 0); add16(c, 34, 0); add16(c, 36, 0);
      add32(c, 38, 0); add32(c, 42, offset); cd.set(name, 46);
      central.push(cd);
      offset += local.length + data.length;
    }
    const directory = concat(central);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    add32(e, 0, 0x06054B50); add16(e, 4, 0); add16(e, 6, 0); add16(e, 8, central.length); add16(e, 10, central.length);
    add32(e, 12, directory.length); add32(e, 16, offset); add16(e, 20, 0);
    return concat([...locals, directory, end]);
  }

  function build(document) {
    const daily = document.daily;
    const rates = daily.map((r) => r.rate);
    const min = Math.min(...rates), max = Math.max(...rates);
    const summary = [
      [str('JISDOR / USD-IDR', 4)],
      [str('Bank Indonesia reference exchange rate')],
      [],
      [str('From month', 6), str(document.from)],
      [str('To month', 6), str(document.to)],
      [str('Published observations', 6), num(daily.length, 0)],
      [str('Arithmetic mean (IDR / USD)', 6), num(document.average, 5, `AVERAGE('Daily Rates'!B2:B${daily.length + 1})`)],
      [str('Minimum daily rate', 6), num(min)],
      [str('Maximum daily rate', 6), num(max)],
      [str('Latest available BI observation', 6), date(document.latest)],
      [str('Includes unfinished current month', 6), str(document.incomplete ? 'Yes' : 'No')],
      [],
      [str('Methodology', 6)],
      [str('Arithmetic mean of published daily JISDOR rates; days without an observation are excluded.')],
      [str('Source: Bank Indonesia; https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx')],
    ];
    const dailyRows = [
      [str('Publication date', 3), str('JISDOR (IDR / 1 USD)', 3), str('Change vs prior BI day', 3)],
      ...daily.map((r) => [date(r.date), num(r.rate), r.delta === null ? null : num(r.delta)]),
    ];
    const monthlyRows = [
      [str('Month', 3), str('Published days', 3), str('Average (IDR / USD)', 3), str('Minimum', 3), str('Maximum', 3), str('Status', 3)],
      ...document.monthly.map((m) => [
        str(m.month), num(m.count, 0), validNumber(m.average) ? num(m.average) : null,
        m.min === null ? null : num(m.min), m.max === null ? null : num(m.max),
        str(m.month === document.to && document.incomplete ? 'In progress' : m.count ? 'Complete' : 'No observations'),
      ]),
    ];
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Daily Rates" sheetId="2" r:id="rId2"/><sheet name="Monthly Averages" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    return makeZip({
      '[Content_Types].xml': types, '_rels/.rels': rels,
      'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': workbookRels,
      'xl/styles.xml': stylesXml(),
      'xl/worksheets/sheet1.xml': worksheet(summary, [57, 35]),
      'xl/worksheets/sheet2.xml': worksheet(dailyRows, [22, 29, 30], true, 1),
      'xl/worksheets/sheet3.xml': worksheet(monthlyRows, [22, 20, 27, 20, 20, 21], true, 1),
    });
  }

  function download(info) {
    const bytes = build(info);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `JISDOR_${info.from}_to_${info.to}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.JisdorXlsx = { download, build };
})();
