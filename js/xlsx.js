// ============================================================
// XLSX minimal — scriere și citire de fișiere Excel (.xlsx) fără biblioteci externe
// ============================================================
// Scriere: un fișier .xlsx este un ZIP cu XML-uri; îl construim cu ZIP „store" (fără compresie), valid pentru Excel.
// Citire: despachetăm ZIP-ul (cu DecompressionStream pentru fișierele salvate de Excel, care sunt comprimate),
//         citim foile, șirurile partajate și stilurile (ca să recunoaștem celulele-dată).
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// ---------- ZIP ----------
function zipStore(files) {                       // files: [{ name, data:Uint8Array }]
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  [...chunks, ...central, new Uint8Array(end.buffer)].forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

async function _inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Browserul tău nu poate citi fișiere Excel comprimate. Folosește Chrome sau Edge, sau salvează fișierul ca CSV.');
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {                      // -> Map(nume -> Uint8Array)
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Nu este un fișier Excel (.xlsx) valid');
  const n = dv.getUint16(eocd + 10, true), dec = new TextDecoder(), out = new Map();
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Fișier ZIP corupt');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    let data = u8.subarray(start, start + csize);
    if (method === 8) data = await _inflateRaw(data); else if (method !== 0) throw new Error('Compresie ZIP nesuportată');
    out.set(name, data);
    p += 46 + nl + el + cl;
  }
  return out;
}

// ---------- scriere XLSX ----------
const _xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const _excelSerial = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5) + 25569;

// Stiluri (indicii folosiți de celule): 0 normal • 1 dată • 2 antet • 3 sumă • 4 capitol • 5 capitol+dată • 6 capitol+sumă
const XL = { S_DATE: 1, S_HEAD: 2, S_MONEY: 3, S_CH: 4, S_CH_DATE: 5, S_CH_MONEY: 6 };
const _XL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDE3F8"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F6"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="7">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="3" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// Celulă: text / număr simplu, sau { v, t:'d'|'n'|'s', s:stil }. t:'d' = dată ISO (aaaa-ll-zz) → dată Excel reală.
function _xlCell(c, r, ci, ri) {
  if (c === null || c === undefined || c === '') return '';
  const o = (typeof c === 'object') ? c : { v: c };
  const ref = _colName(ci) + (ri + 1), s = o.s ? ' s="' + o.s + '"' : '';
  if (o.v === null || o.v === undefined || o.v === '') return o.s ? '<c r="' + ref + '"' + s + '/>' : '';
  const t = o.t || (typeof o.v === 'number' ? 'n' : 's');
  if (t === 'd') return /^\d{4}-\d{2}-\d{2}$/.test(o.v) ? '<c r="' + ref + '"' + s + '><v>' + _excelSerial(o.v) + '</v></c>' : '<c r="' + ref + '"' + s + '/>';
  if (t === 'n' && isFinite(+o.v)) return '<c r="' + ref + '"' + s + '><v>' + (+o.v) + '</v></c>';
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + _xmlEsc(o.v) + '</t></is></c>';
}

// sheets: [{ name, widths:[…], rows:[[celulă,…],…], freezeHeader, filter }]  → Uint8Array (.xlsx)
function xlsxBuild(sheets) {
  const enc = new TextEncoder(), files = [], head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const safeName = (n, i) => (String(n || 'Foaia ' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Foaia ' + (i + 1));
  files.push({ name: '[Content_Types].xml', data: enc.encode(head
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') });
  files.push({ name: '_rels/.rels', data: enc.encode(head
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
  files.push({ name: 'xl/workbook.xml', data: enc.encode(head
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>'
    + sheets.map((s, i) => '<sheet name="' + _xmlEsc(safeName(s.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
    + '</sheets></workbook>') });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(head
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') });
  files.push({ name: 'xl/styles.xml', data: enc.encode(_XL_STYLES) });
  sheets.forEach((s, si) => {
    const rows = s.rows || [], ncol = Math.max(1, ...rows.map(r => r.length));
    const cols = (s.widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const data = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((c, ci) => _xlCell(c, r, ci, ri)).join('') + '</row>').join('');
    const view = '<sheetViews><sheetView workbookViewId="0"' + (si === 0 ? ' tabSelected="1"' : '') + '>'
      + (s.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '') + '</sheetView></sheetViews>';
    files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data: enc.encode(head
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + view
      + '<sheetFormatPr defaultRowHeight="15"/>' + (cols ? '<cols>' + cols + '</cols>' : '')
      + '<sheetData>' + data + '</sheetData>'
      + (s.filter && rows.length > 1 ? '<autoFilter ref="A1:' + _colName(ncol - 1) + rows.length + '"/>' : '')
      + '</worksheet>') });
  });
  return zipStore(files);
}

// ---------- citire XLSX ----------
const _isDateFmtId = id => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
const _isDateFmtCode = code => { const c = String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''); return /[dmyhs]/i.test(c) && !/^(general|0|#)/i.test(c.trim()); };
const _serialToISO = n => { const d = new Date(Math.round((Math.floor(n) - 25569) * 864e5)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
const _colIndex = ref => { const m = /^([A-Z]+)/i.exec(ref); let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

async function xlsxRead(buf) {                   // -> { sheets:[{ name, rows:[[valoare,…],…] }] }; celulele-dată devin 'aaaa-ll-zz'
  const files = await unzip(buf), dec = new TextDecoder();
  const xml = n => files.has(n) ? new DOMParser().parseFromString(dec.decode(files.get(n)), 'application/xml') : null;
  const wb = xml('xl/workbook.xml'); if (!wb) throw new Error('Fișier Excel invalid (lipsește workbook.xml)');
  const rels = {}; const relDoc = xml('xl/_rels/workbook.xml.rels');
  if (relDoc) [...relDoc.getElementsByTagName('Relationship')].forEach(r => { let t = r.getAttribute('Target'); t = t.startsWith('/') ? t.slice(1) : 'xl/' + t; rels[r.getAttribute('Id')] = t; });
  const shared = [], ss = xml('xl/sharedStrings.xml');
  if (ss) [...ss.getElementsByTagName('si')].forEach(si => {
    let s = ''; [...si.childNodes].forEach(ch => { if (ch.nodeName === 't') s += ch.textContent; else if (ch.nodeName === 'r') [...ch.childNodes].forEach(x => { if (x.nodeName === 't') s += x.textContent; }); });
    shared.push(s);
  });
  const dateXf = [], st = xml('xl/styles.xml');
  if (st) {
    const codes = {}; [...st.getElementsByTagName('numFmt')].forEach(n => { codes[n.getAttribute('numFmtId')] = n.getAttribute('formatCode'); });
    const xfs = st.getElementsByTagName('cellXfs')[0];
    if (xfs) [...xfs.getElementsByTagName('xf')].forEach(x => { const id = +x.getAttribute('numFmtId') || 0; dateXf.push(codes[id] !== undefined ? _isDateFmtCode(codes[id]) : _isDateFmtId(id)); });
  }
  const sheets = [];
  for (const sh of [...wb.getElementsByTagName('sheet')]) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const doc = xml(rels[rid]); if (!doc) continue;
    const rows = [];
    [...doc.getElementsByTagName('row')].forEach(row => {
      const ri = (+row.getAttribute('r') || rows.length + 1) - 1, arr = [];
      [...row.getElementsByTagName('c')].forEach(c => {
        const ci = _colIndex(c.getAttribute('r') || 'A1'), t = c.getAttribute('t'), s = +c.getAttribute('s') || 0, vEl = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (vEl) {
          const raw = vEl.textContent;
          if (t === 's') val = shared[+raw] !== undefined ? shared[+raw] : '';
          else if (t === 'str') val = raw;
          else if (t === 'b') val = raw === '1';
          else if (t === 'e') val = '';
          else { const num = parseFloat(raw); val = isFinite(num) ? (dateXf[s] && num > 0 ? _serialToISO(num) : num) : raw; }
        }
        arr[ci] = val;
      });
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      rows[ri] = arr;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name: sh.getAttribute('name'), rows });
  }
  return { sheets };
}

// ---------- CSV ----------
function csvParse(text) {
  text = String(text).replace(/^﻿/, '');
  let forced = null;                               // linia „sep=;" (o pune Excel / exportul nostru ca să știe separatorul)
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) { forced = sep[1]; text = text.slice(sep[0].length); }
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length };
  const delim = forced || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ';';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function csvBuild(rows, delim) {
  delim = delim || ';';
  const q = v => { v = v === null || v === undefined ? '' : String(v); return /["\r\n]/.test(v) || v.includes(delim) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  // BOM UTF-8 la început: Excel citește corect diacriticele (nu punem „sep=", pentru că atunci Excel ignoră BOM-ul)
  return '﻿' + rows.map(r => r.map(q).join(delim)).join('\r\n') + '\r\n';
}
