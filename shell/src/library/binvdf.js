// Valve's binary KeyValues format, as used by Steam's shortcuts.vdf.
// Parsed into ordered entries so existing data is written back untouched:
//   node = [{ key, type, value }]   (value is a node for maps)
const T = { MAP: 0x00, STRING: 0x01, INT32: 0x02, FLOAT32: 0x03, UINT64: 0x07, END: 0x08, INT64: 0x0a };

function parse(buf) {
  let pos = 0;
  const cstr = () => {
    const end = buf.indexOf(0, pos);
    if (end < 0) throw new Error('Corrupt VDF: unterminated string');
    const s = buf.toString('utf8', pos, end);
    pos = end + 1;
    return s;
  };
  function map() {
    const node = [];
    while (pos < buf.length) {
      const type = buf[pos++];
      if (type === T.END) return node;
      const key = cstr();
      let value;
      switch (type) {
        case T.MAP: value = map(); break;
        case T.STRING: value = cstr(); break;
        case T.INT32: value = buf.readInt32LE(pos); pos += 4; break;
        case T.FLOAT32: value = buf.readFloatLE(pos); pos += 4; break;
        case T.UINT64: value = buf.readBigUInt64LE(pos); pos += 8; break;
        case T.INT64: value = buf.readBigInt64LE(pos); pos += 8; break;
        default: throw new Error(`Corrupt VDF: unknown type 0x${type.toString(16)} at ${pos - 1}`);
      }
      node.push({ key, type, value });
    }
    return node;
  }
  return map();
}

function serialize(node) {
  const parts = [];
  const cstr = (s) => { parts.push(Buffer.from(String(s), 'utf8'), Buffer.from([0])); };
  (function write(n) {
    for (const { key, type, value } of n) {
      parts.push(Buffer.from([type]));
      cstr(key);
      switch (type) {
        case T.MAP: write(value); break;
        case T.STRING: cstr(value); break;
        case T.INT32: { const b = Buffer.alloc(4); b.writeInt32LE(value); parts.push(b); break; }
        case T.FLOAT32: { const b = Buffer.alloc(4); b.writeFloatLE(value); parts.push(b); break; }
        case T.UINT64: { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); parts.push(b); break; }
        case T.INT64: { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(value)); parts.push(b); break; }
        default: throw new Error(`Unknown VDF type ${type}`);
      }
    }
    parts.push(Buffer.from([T.END]));
  })(node);
  return Buffer.concat(parts);
}

// Helpers for working with parsed nodes.
const get = (node, key) => (node.find((e) => e.key.toLowerCase() === key.toLowerCase()) || {}).value;
const str = (key, value) => ({ key, type: T.STRING, value });
const int = (key, value) => ({ key, type: T.INT32, value });
const map = (key, value) => ({ key, type: T.MAP, value });

module.exports = { parse, serialize, get, str, int, map, T };
