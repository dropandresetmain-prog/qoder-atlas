/**
 * Test helper — minimal dependency-free XLSX (ZIP) writer.
 *
 * Builds a tiny but structurally valid OOXML container:
 *   - one shared-strings table with the strings you pass in;
 *   - one worksheet (sheet1) with the rows you pass in, referencing the
 *     shared strings by index (t="s" cells);
 *   - minimal workbook.xml + .rels so a generic reader can resolve sheet1.
 *
 * Compression is DEFLATE via node:zlib; we hand-roll the local + central +
 * EOCD records because we want this to be readable by `parseXlsxRoster` in
 * src/intake/programmeXlsx.ts.
 */
import { type XlsxBuildOptions } from './northstar-xlsx-types.ts';

const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface CentralEntry {
  name: string;
  method: 0 | 8;
  crc: number;
  localHeaderOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  compressed: Buffer;
}

function buildLocalHeader(name: string, compressed: Buffer, uncompressed: Buffer, method: 0 | 8, crc: number): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const out = Buffer.alloc(30 + nameBuf.length);
  out.writeUInt32LE(0x04034b50, 0);
  out.writeUInt16LE(20, 4);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(method, 8);
  out.writeUInt16LE(0, 10);
  out.writeUInt16LE(0, 12);
  out.writeUInt32LE(crc, 14);
  out.writeUInt32LE(compressed.length, 18);
  out.writeUInt32LE(uncompressed.length, 22);
  out.writeUInt16LE(nameBuf.length, 26);
  out.writeUInt16LE(0, 28);
  nameBuf.copy(out, 30);
  return Buffer.concat([out, compressed]);
}

function buildCentralDirectory(entries: CentralEntry[]): Buffer {
  const records: Buffer[] = [];
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const rec = Buffer.alloc(46 + nameBuf.length);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(0, 8);
    rec.writeUInt16LE(e.method, 10);
    rec.writeUInt16LE(0, 12);
    rec.writeUInt16LE(0, 14);
    rec.writeUInt32LE(e.crc, 16);
    rec.writeUInt32LE(e.compressedSize, 20);
    rec.writeUInt32LE(e.uncompressedSize, 24);
    rec.writeUInt16LE(nameBuf.length, 28);
    rec.writeUInt16LE(0, 30);
    rec.writeUInt16LE(0, 32);
    rec.writeUInt16LE(0, 34);
    rec.writeUInt16LE(0, 36);
    rec.writeUInt32LE(0, 38);
    rec.writeUInt32LE(e.localHeaderOffset, 42);
    nameBuf.copy(rec, 46);
    records.push(rec);
  }
  return Buffer.concat(records);
}

function buildEocd(entries: CentralEntry[], cdOffset: number, cdSize: number): Buffer {
  const out = Buffer.alloc(22);
  out.writeUInt32LE(0x06054b50, 0);
  out.writeUInt16LE(0, 4);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(entries.length, 8);
  out.writeUInt16LE(entries.length, 10);
  out.writeUInt32LE(cdSize, 12);
  out.writeUInt32LE(cdOffset, 16);
  out.writeUInt16LE(0, 20);
  return out;
}

function colLetter(col: number): string {
  let n = col;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSharedStringsXml(strings: string[]): Buffer {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'];
  parts.push('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
  parts.push(` count="${strings.length}" uniqueCount="${strings.length}">`);
  for (const s of strings) {
    parts.push('<si><t xml:space="preserve">');
    parts.push(xmlEscape(s));
    parts.push('</t></si>');
  }
  parts.push('</sst>');
  return Buffer.from(parts.join(''), 'utf8');
}

function buildSheetXml(rows: string[][], sharedIndex: Map<string, number>): Buffer {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'];
  parts.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );
  parts.push('<sheetData>');
  rows.forEach((cells, rowIndex) => {
    const rowNumber = rowIndex + 1;
    parts.push(`<row r="${rowNumber}">`);
    cells.forEach((value, colIndex) => {
      const ref = `${colLetter(colIndex)}${rowNumber}`;
      const index = sharedIndex.get(value);
      if (index === undefined) {
        parts.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">`);
        parts.push(xmlEscape(value));
        parts.push('</t></is></c>');
      } else {
        parts.push(`<c r="${ref}" t="s"><v>${index}</v></c>`);
      }
    });
    parts.push('</row>');
  });
  parts.push('</sheetData>');
  parts.push('</worksheet>');
  return Buffer.from(parts.join(''), 'utf8');
}

function buildWorkbookXml(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
    'utf8',
  );
}

function buildRelsXml(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'utf8',
  );
}

function buildContentTypesXml(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
    'utf8',
  );
}

/**
 * Build a minimal XLSX buffer with a single worksheet. The first row of
 * `rows` is the header. Values are added to the shared-strings table and
 * referenced via t="s" cells.
 */
export function buildMinimalXlsx(options: XlsxBuildOptions): Buffer {
  const allRows: string[][] = [options.headers, ...options.rows];

  // Build shared string table from all cells, preserving first occurrence.
  const sharedIndex = new Map<string, number>();
  const orderedStrings: string[] = [];
  for (const row of allRows) {
    for (const cell of row) {
      if (!sharedIndex.has(cell)) {
        sharedIndex.set(cell, orderedStrings.length);
        orderedStrings.push(cell);
      }
    }
  }

  const parts: Array<{ name: string; data: Buffer }> = [
    { name: '[Content_Types].xml', data: buildContentTypesXml() },
    { name: '_rels/.rels', data: buildRelsXml() },
    { name: 'xl/workbook.xml', data: buildWorkbookXml() },
    { name: 'xl/sharedStrings.xml', data: buildSharedStringsXml(orderedStrings) },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheetXml(allRows, sharedIndex) },
  ];

  const localChunks: Buffer[] = [];
  const centralEntries: CentralEntry[] = [];
  let cursor = 0;
  for (const part of parts) {
    const method: 0 | 8 = 0;
    const compressed = part.data; // store uncompressed for simplicity
    const crc = crc32(part.data);
    const local = buildLocalHeader(part.name, compressed, part.data, method, crc);
    localChunks.push(local);
    centralEntries.push({
      name: part.name,
      method,
      crc,
      localHeaderOffset: cursor,
      compressedSize: compressed.length,
      uncompressedSize: part.data.length,
      compressed,
    });
    cursor += local.length;
  }

  const cd = buildCentralDirectory(centralEntries);
  const cdOffset = cursor;
  const eocd = buildEocd(centralEntries, cdOffset, cd.length);
  return Buffer.concat([...localChunks, cd, eocd]);
}
