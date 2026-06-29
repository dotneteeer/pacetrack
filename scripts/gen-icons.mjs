import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

function solidPng(size, r, g, b) {
  function u32be(n) {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n >>> 0, 0);
    return b;
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const byte of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ byte) & 0xFF];
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = u32be(crc32(Buffer.concat([t, d])));
    return Buffer.concat([u32be(d.length), t, d, crc]);
  }

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data: filter(0) + RGB per row
  const row = Buffer.allocUnsafe(1 + size * 3);
  row[0] = 0;
  for (let x = 0; x < size; x++) { row[1 + x*3] = r; row[2 + x*3] = g; row[3 + x*3] = b; }
  const raw = Buffer.concat(Array(size).fill(row));

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });

// icon-192.png: #FC4C02 orange (252, 76, 2)
writeFileSync('public/icons/icon-192.png', solidPng(192, 252, 76, 2));
// icon-512.png: #FC4C02 orange
writeFileSync('public/icons/icon-512.png', solidPng(512, 252, 76, 2));
// icon-maskable.png: #FC4C02 orange (maskable — same design)
writeFileSync('public/icons/icon-maskable.png', solidPng(512, 252, 76, 2));

console.log('Icons generated: public/icons/icon-192.png, icon-512.png, icon-maskable.png');
