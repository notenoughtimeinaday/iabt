const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
};

export const createZip = (files) => {
  const local = [];
  const central = [];
  let offset = 0;

  for (const [nameValue, content] of Object.entries(files)) {
    const name = Buffer.from(nameValue.replace(/\\/g, "/"), "utf8");
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const checksum = crc32(bytes);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(bytes.length),
      u32(bytes.length),
      u16(name.length),
      u16(0),
      name
    ]);
    local.push(localHeader, bytes);

    central.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(bytes.length),
      u32(bytes.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]));
    offset += localHeader.length + bytes.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0)
  ]);
  return Buffer.concat([...local, centralBytes, end]);
};