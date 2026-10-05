var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/pack/shellBuilder.ts
function entry(path, data) {
  return { path, data };
}
function recordEnd(fileCount) {
  return REC_OFF + 16 * (2 + fileCount);
}
function blobFor(path, data) {
  for (const ch of path) {
    const c = ch.codePointAt(0);
    if (c < 32 || c >= 127) {
      throw new PackError(`\u69FD\u8DEF\u5F84\u5FC5\u987B\u662F\u53EF\u6253\u5370 ASCII: ${path}`);
    }
  }
  if (path.length === 0) throw new PackError(`\u69FD\u8DEF\u5F84\u5FC5\u987B\u662F\u53EF\u6253\u5370 ASCII: ${path}`);
  const pb = new TextEncoder().encode(path);
  if (data.length >= 1 << 24) throw new PackError(`${path} \u8D85\u8FC7\u5355\u69FD 24bit \u957F\u5EA6\u4E0A\u9650(16MB)`);
  if (pb.length >= 256) throw new PackError(`\u69FD\u8DEF\u5F84\u592A\u957F: ${path}`);
  const head = u32(data.length & 16777215 | pb.length << 24);
  const out = new Uint8Array(BLOB_HDR_LEN + pb.length + data.length);
  out.set(head, 0);
  out.set(pb, BLOB_HDR_LEN);
  out.set(data, BLOB_HDR_LEN + pb.length);
  return out;
}
function build(files, pkgName, displayName, preview, themeName = DEFAULT_THEME_NAME, deviceCode = DEVICE_CODE) {
  checkPkg(pkgName);
  checkName(displayName);
  const pkg = new TextEncoder().encode(pkgName);
  const nb = encodeUtf8(displayName);
  const tb = encodeUtf8(themeName);
  if (tb.length > THEME_NAME_MAX) throw new PackError("\u4E3B\u9898\u540D\u8FC7\u957F");
  checkPreview(preview);
  if (files.length < 1 || files.length >= 256) {
    throw new PackError(`\u6587\u4EF6\u6761\u6570\u5FC5\u987B\u5728 1..255(\u69FD\u53F7\u5360\u4E00\u4E2A\u5B57\u8282), \u73B0\u5728 ${files.length}`);
  }
  const n = files.length;
  const recEnd = recordEnd(n);
  const firstRec = REC_OFF + 16;
  const tailRec = recEnd - 16;
  const fileRegion = recEnd + preview.length;
  const shell = new Uint8Array(fileRegion);
  writeU32(shell, 0, MAGIC);
  writeU32(shell, 4, deviceCode);
  writeU32(shell, 16, 2048);
  writeU32(shell, 20, 65536);
  writeU32(shell, 28, 1);
  writeU32(shell, 32, recEnd);
  shell.set(pkg, PKG_OFF);
  shell.set(nb, NAME_OFF);
  writeU32(shell, THEME_OFF, 2147483648);
  writeU32(shell, THEME_OFF + 4, recEnd);
  writeU32(shell, THEME_OFF + 8, 1);
  writeU32(shell, THEME_OFF + 12, REC_OFF);
  for (let i = 0; i < THEME_PTR_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * i;
    writeU32(shell, at, at === FILE_CNT_OFF ? n : 0);
    writeU32(shell, at + 4, firstRec);
  }
  for (let i = 0; i < THEME_TAIL_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * (THEME_PTR_SLOTS + i);
    writeU32(shell, at, 0);
    writeU32(shell, at + 4, tailRec);
  }
  shell.set(tb, THEME_NAME_OFF);
  writeU32(shell, REC_OFF, 0);
  writeU32(shell, REC_OFF + 4, 0);
  writeU32(shell, REC_OFF + 8, tailRec);
  writeU32(shell, REC_OFF + 12, 16);
  const blobs = [];
  let pos = fileRegion;
  files.forEach((e, i) => {
    const blob = blobFor(e.path, e.data);
    const at = REC_OFF + 16 * (1 + i);
    writeU32(shell, at, REC_UID_BASE + i);
    writeU32(shell, at + 4, 0);
    writeU32(shell, at + 8, pos);
    writeU32(shell, at + 12, blob.length);
    blobs.push(blob);
    pos += blob.length;
  });
  writeU32(shell, tailRec, REC_UID_BASE);
  writeU32(shell, tailRec + 4, 0);
  writeU32(shell, tailRec + 8, 0);
  writeU32(shell, tailRec + 12, 0);
  shell.set(preview, recEnd);
  const out = new Uint8Array(pos);
  out.set(shell, 0);
  let at2 = fileRegion;
  for (const b of blobs) {
    out.set(b, at2);
    at2 += b.length;
  }
  if (out.length !== pos) throw new PackError(`\u5E03\u5C40\u4E0D\u81EA\u6D3D: \u9884\u671F ${pos} \u5B9E\u9645 ${out.length}`);
  return out;
}
function hex(v) {
  return "0x" + v.toString(16);
}
function checkPreview(preview) {
  if (preview.length < PREVIEW_HDR) throw new PackError("\u9884\u89C8\u5757\u592A\u77ED");
  const tag = readU32(preview, 0);
  if (tag !== PREVIEW_TAG) throw new PackError(`\u9884\u89C8\u5757\u6807\u7B7E\u4E0D\u5BF9: ${hex(tag)}`);
  const plen = readU32(preview, 8);
  if (plen < 0 || preview.length !== PREVIEW_HDR + plen) {
    throw new PackError("\u9884\u89C8\u5757\u957F\u5EA6\u4E0E\u5934\u91CC\u7684\u5B57\u6BB5\u4E0D\u7B26");
  }
}
function previewOf(raw) {
  const recEnd = readU32(raw, 32);
  const tag = readU32(raw, recEnd);
  if (tag !== PREVIEW_TAG) throw new PackError(`\u9884\u89C8\u5757\u6807\u7B7E\u4E0D\u5BF9: ${hex(tag)}`);
  const plen = readU32(raw, recEnd + 8);
  if (recEnd + PREVIEW_HDR + plen > raw.length) throw new PackError("\u9884\u89C8\u5757\u8D8A\u754C");
  return raw.slice(recEnd, recEnd + PREVIEW_HDR + plen);
}
function parse(raw) {
  if (raw.length < REC_OFF + 16 * 3) throw new PackError("\u5BB9\u5668\u592A\u77ED");
  if (readU32(raw, 0) !== MAGIC) throw new PackError("\u5BB9\u5668\u9B54\u6570\u4E0D\u7B26");
  if (readU32(raw, 4) !== DEVICE_CODE) {
    throw new PackError("\u8BBE\u5907\u7801\u4E0D\u662F 10 Pro(0x10000)");
  }
  const n = readU32(raw, FILE_CNT_OFF);
  if (n < 1 || n > 255) throw new PackError(`\u6587\u4EF6\u6761\u6570\u975E\u6CD5: ${n}`);
  const recEnd = readU32(raw, 32);
  if (recEnd !== recordEnd(n)) throw new PackError(`\u8BB0\u5F55\u8868\u7ED3\u675F\u5730\u5740\u4E0E\u6761\u6570\u4E0D\u7B26: ${recEnd}`);
  if (readU32(raw, THEME_OFF + 4) !== recEnd) {
    throw new PackError("\u4E3B\u9898\u8868\u7684\u8BB0\u5F55\u8868\u6307\u9488\u4E0E 0x20 \u4E0D\u4E00\u81F4");
  }
  if (readU32(raw, THEME_OFF) !== 2147483648) {
    throw new PackError("\u4E3B\u9898\u8868\u9996\u5B57\u4E0D\u5BF9");
  }
  if (readU32(raw, THEME_OFF + 8) !== 1) throw new PackError("\u4E3B\u9898\u6570\u4E0D\u662F 1");
  if (readU32(raw, THEME_OFF + 12) !== REC_OFF) {
    throw new PackError("\u4E3B\u9898\u8868\u91CC\u7684\u8BB0\u5F55\u8868\u5730\u5740\u4E0D\u5BF9");
  }
  const firstRec = REC_OFF + 16;
  const tailRec = recEnd - 16;
  for (let i = 0; i < THEME_PTR_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * i;
    const cnt = readU32(raw, at);
    if (cnt !== (at === FILE_CNT_OFF ? n : 0)) throw new PackError(`\u4E3B\u9898\u8868\u8BA1\u6570\u69FD ${i} \u4E0D\u5BF9`);
    if (readU32(raw, at + 4) !== firstRec) throw new PackError(`\u4E3B\u9898\u8868\u9996\u8BB0\u5F55\u6307\u9488 ${i} \u4E0D\u5BF9`);
  }
  for (let i = 0; i < THEME_TAIL_SLOTS; i++) {
    const at = THEME_OFF + 16 + 8 * (THEME_PTR_SLOTS + i);
    if (readU32(raw, at) !== 0) throw new PackError(`\u4E3B\u9898\u8868\u5C3E\u69FD ${i} \u8BA1\u6570\u4E0D\u662F 0`);
    if (readU32(raw, at + 4) !== tailRec) throw new PackError(`\u4E3B\u9898\u8868\u5C3E\u8BB0\u5F55\u6307\u9488 ${i} \u4E0D\u5BF9`);
  }
  if (readU32(raw, REC_OFF) !== 0 || readU32(raw, REC_OFF + 12) !== 16 || readU32(raw, REC_OFF + 8) !== tailRec) {
    throw new PackError("\u8BB0\u5F55\u8868\u9996\u6761\u5F62\u72B6\u4E0D\u5BF9");
  }
  if (readU32(raw, tailRec) !== REC_UID_BASE || readU32(raw, tailRec + 4) !== 0 || readU32(raw, tailRec + 8) !== 0 || readU32(raw, tailRec + 12) !== 0) {
    throw new PackError("\u5C3E\u6807\u8BB0\u4E0D\u5BF9");
  }
  const preview = previewOf(raw);
  const fileRegion = recEnd + preview.length;
  const files = [];
  let expectOff = fileRegion;
  for (let i = 0; i < n; i++) {
    const at = REC_OFF + 16 * (1 + i);
    if (readU32(raw, at) !== REC_UID_BASE + i) {
      throw new PackError(`\u7B2C ${i + 1} \u6761\u8BB0\u5F55\u7684\u69FD\u53F7\u4E0D\u5BF9`);
    }
    const off = readU32(raw, at + 8);
    const len = readU32(raw, at + 12);
    if (off !== expectOff) throw new PackError(`\u7B2C ${i + 1} \u6761\u8BB0\u5F55\u8D77\u70B9\u4E0D\u8FDE\u7EED: ${off}`);
    if (len < BLOB_HDR_LEN || off + len > raw.length) throw new PackError(`\u7B2C ${i + 1} \u6761\u8BB0\u5F55\u8D8A\u754C`);
    const head = readU32(raw, off);
    const dlen = head & 16777215;
    const plen = head >>> 24;
    if (BLOB_HDR_LEN + plen + dlen !== len) throw new PackError(`\u7B2C ${i + 1} \u6761\u5C0F\u5934\u957F\u5EA6\u5BF9\u4E0D\u4E0A`);
    for (let k = 4; k < BLOB_HDR_LEN; k++) {
      if (raw[off + k] !== 0) throw new PackError(`\u7B2C ${i + 1} \u6761\u5C0F\u5934\u4FDD\u7559\u5B57\u8282\u975E 0`);
    }
    const path = decodeAscii(raw.subarray(off + BLOB_HDR_LEN, off + BLOB_HDR_LEN + plen));
    const data = raw.slice(off + BLOB_HDR_LEN + plen, off + len);
    files.push([path, data]);
    expectOff += len;
  }
  if (expectOff !== raw.length) {
    throw new PackError(`\u6587\u4EF6\u533A\u7ED3\u5C3E\u591A\u51FA ${raw.length - expectOff} \u5B57\u8282`);
  }
  const zeroAt = raw.indexOf(0, NAME_OFF);
  const zero = (zeroAt >= 0 && zeroAt < NAME_OFF + NAME_MAX ? zeroAt : NAME_OFF + NAME_MAX) - NAME_OFF;
  const themeZeroAt = raw.indexOf(0, THEME_NAME_OFF);
  const themeZero = (themeZeroAt >= 0 && themeZeroAt < THEME_NAME_OFF + THEME_NAME_MAX ? themeZeroAt : THEME_NAME_OFF + THEME_NAME_MAX) - THEME_NAME_OFF;
  return {
    files,
    pkg: decodeAscii(raw.subarray(PKG_OFF, PKG_OFF + PKG_LEN)),
    displayName: decodeUtf8(raw.subarray(NAME_OFF, NAME_OFF + zero)),
    themeName: decodeUtf8(raw.subarray(THEME_NAME_OFF, THEME_NAME_OFF + themeZero)),
    preview,
    fileRegion
  };
}
function verifyBuilt(out, pkgName, packName, entries) {
  const p = parse(out);
  if (p.pkg !== pkgName) throw new PackError(`\u5305\u540D\u5199\u9519: ${p.pkg}`);
  if (p.displayName !== packName) throw new PackError(`\u8868\u76D8\u540D\u5199\u9519: ${p.displayName}`);
  if (p.files.length !== entries.length) {
    throw new PackError(`\u69FD\u6570\u4E0D\u7B26: \u671F\u671B ${entries.length}, \u5B9E\u9645 ${p.files.length}`);
  }
  entries.forEach((e, i) => {
    const [path, data] = p.files[i];
    if (path !== e.path) throw new PackError(`\u7B2C ${i + 1} \u69FD\u8DEF\u5F84\u4E0D\u7B26: ${path}`);
    if (!bytesEqual(data, e.data)) throw new PackError(`\u7B2C ${i + 1} \u69FD\u5185\u5BB9\u4E0D\u4E00\u81F4: ${path}`);
  });
  checkPkgAgainst(pkgName);
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
var MAGIC, DEVICE_CODE, PREVIEW_TAG, PREVIEW_HDR, REC_OFF, PKG_OFF, PKG_LEN, NAME_OFF, NAME_MAX, THEME_OFF, THEME_END, FILE_CNT_OFF, THEME_NAME_OFF, THEME_NAME_MAX, THEME_PTR_SLOTS, THEME_TAIL_SLOTS, REC_UID_BASE, BLOB_HDR_LEN, DEFAULT_THEME_NAME;
var init_shellBuilder = __esm({
  "src/lib/pack/shellBuilder.ts"() {
    "use strict";
    init_shellWriter();
    MAGIC = 305440090;
    DEVICE_CODE = 65536;
    PREVIEW_TAG = 1040;
    PREVIEW_HDR = 12;
    REC_OFF = 328;
    PKG_OFF = 40;
    PKG_LEN = 12;
    NAME_OFF = 104;
    NAME_MAX = 64;
    THEME_OFF = 168;
    THEME_END = 328;
    FILE_CNT_OFF = 216;
    THEME_NAME_OFF = 256;
    THEME_NAME_MAX = THEME_END - THEME_NAME_OFF;
    THEME_PTR_SLOTS = 5;
    THEME_TAIL_SLOTS = 4;
    REC_UID_BASE = 83886080;
    BLOB_HDR_LEN = 20;
    DEFAULT_THEME_NAME = "\u6837\u5F0F1";
  }
});

// src/lib/hash/sha256.ts
function sha256(data) {
  const H = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const l = data.length;
  const bitLenHi = Math.floor(l / 536870912) >>> 0;
  const bitLenLo = l * 8 % 4294967296;
  const paddedLen = (l + 8 >> 6 << 6) + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[l] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi, false);
  dv.setUint32(paddedLen - 4, bitLenLo, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ y >>> 10) >>> 0;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = (e & f ^ ~e & g) >>> 0;
      const t1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = (a & b ^ a & c ^ b & c) >>> 0;
      const t2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i], false);
  return out;
}
var K, rotr;
var init_sha256 = __esm({
  "src/lib/hash/sha256.ts"() {
    "use strict";
    K = new Uint32Array([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    rotr = (x, n) => (x >>> n | x << 32 - n) >>> 0;
  }
});

// src/lib/pack/shellWriter.ts
function decodeAscii(b) {
  return asciiDec.decode(b);
}
function encodeUtf8(s2) {
  return utf8Enc.encode(s2);
}
function decodeUtf8(b) {
  return utf8Dec.decode(b);
}
function pkgFor(blob) {
  const h = sha256(blob);
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + h[i];
  return PKG_PREFIX + String(n % 1e8).padStart(8, "0");
}
function checkPkg(pkg) {
  if (!/^[0-9]{12}$/.test(pkg)) {
    throw new PackError(`\u8868\u76D8 ID \u5FC5\u987B\u662F 12 \u4F4D\u6570\u5B57, \u73B0\u5728\u662F\u300C${pkg}\u300D`);
  }
}
function checkPkgAgainst(pkg, mainPkg = MAIN_PKG) {
  if (pkg === mainPkg) {
    throw new PackError(`\u8868\u76D8 ID \u649E\u4E0A\u4E86\u4E3B\u5305\u53F7 ${mainPkg}, \u4FA7\u8F7D\u4F1A\u5224\u91CD\u590D\u5B89\u88C5`);
  }
}
function checkName(name) {
  const n = utf8Enc.encode(name).length;
  if (n === 0) throw new PackError("\u8868\u76D8\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  if (n >= NAME_MAX) throw new PackError(`\u8868\u76D8\u540D\u79F0\u592A\u957F(${n} \u5B57\u8282, \u4E0A\u9650 ${NAME_MAX - 1} \u5B57\u8282)`);
}
function readEntry(out, index1) {
  const off = readU32(out, REC_OFF + index1 * 16 + 8);
  const head = readU32(out, off);
  const dlen = head & 16777215;
  const plen = head >>> 24;
  const path = decodeAscii(out.subarray(off + BLOB_HDR_LEN, off + BLOB_HDR_LEN + plen));
  const data = out.slice(
    off + BLOB_HDR_LEN + plen,
    off + BLOB_HDR_LEN + plen + dlen
  );
  return [path, data];
}
function readU32(b, o) {
  return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
}
function writeU32(b, o, v) {
  b[o] = v & 255;
  b[o + 1] = v >>> 8 & 255;
  b[o + 2] = v >>> 16 & 255;
  b[o + 3] = v >>> 24 & 255;
}
function u32(v) {
  const out = new Uint8Array(4);
  writeU32(out, 0, v);
  return out;
}
var MAIN_PKG, PKG_PREFIX, PackError, asciiDec, utf8Dec, utf8Enc;
var init_shellWriter = __esm({
  "src/lib/pack/shellWriter.ts"() {
    "use strict";
    init_shellBuilder();
    init_sha256();
    MAIN_PKG = "979820260926";
    PKG_PREFIX = "4348";
    PackError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "PackError";
      }
    };
    asciiDec = new TextDecoder("us-ascii");
    utf8Dec = new TextDecoder("utf-8");
    utf8Enc = new TextEncoder();
  }
});

// src/lib/pack/cipk.ts
function icon(stem, data) {
  return { stem, data };
}
function fileNameOf(i) {
  return `${i.stem}.bin`;
}
function buildCipk(icons) {
  if (icons.length === 0) throw new CipkError("\u4E00\u5F20\u56FE\u6807\u90FD\u6CA1\u6709, \u6253\u4E0D\u51FA\u5305");
  if (icons.length > COUNT_MAX) throw new CipkError(`\u56FE\u6807\u5F20\u6570\u8D85\u8FC7\u4E0A\u9650 ${COUNT_MAX}`);
  const seen = /* @__PURE__ */ new Set();
  const chunks = [];
  let total = 0;
  const head = new Uint8Array(8);
  head.set(enc.encode(CIPK_MAGIC), 0);
  writeU32(head, 4, icons.length);
  chunks.push(head);
  total += head.length;
  for (const i of icons) {
    const nb = enc.encode(fileNameOf(i));
    if (nb.length > NAME_MAX2) throw new CipkError(`\u56FE\u6807\u6587\u4EF6\u540D\u592A\u957F: ${fileNameOf(i)}`);
    if (!NAME_RE.test(fileNameOf(i))) throw new CipkError(`\u56FE\u6807\u6587\u4EF6\u540D\u4E0D\u5408\u89C4: ${fileNameOf(i)}`);
    if (seen.has(i.stem)) throw new CipkError(`\u56FE\u6807\u91CD\u590D: ${i.stem}`);
    seen.add(i.stem);
    if (i.data.length === 0 || i.data.length > ICON_LEN_MAX) {
      throw new CipkError(`${fileNameOf(i)} \u957F\u5EA6 ${i.data.length} \u8D85\u51FA\u5355\u5F20\u4E0A\u9650 ${ICON_LEN_MAX}`);
    }
    const piece = new Uint8Array(5 + nb.length + i.data.length);
    writeU32(piece, 0, i.data.length);
    piece[4] = nb.length;
    piece.set(nb, 5);
    piece.set(i.data, 5 + nb.length);
    chunks.push(piece);
    total += piece.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
function parseCipk(blob) {
  if (blob.length < 8 || new TextDecoder("ascii").decode(blob.subarray(0, 4)) !== CIPK_MAGIC) {
    throw new CipkError("CIPK \u9B54\u6570\u4E0D\u7B26");
  }
  const count2 = readU32(blob, 4);
  if (count2 < 1 || count2 > COUNT_MAX) throw new CipkError(`\u5F20\u6570\u975E\u6CD5: ${count2}`);
  const out = [];
  let pos = 8;
  for (let idx = 0; idx < count2; idx++) {
    if (pos + 5 > blob.length) throw new CipkError(`\u7B2C ${idx + 1} \u5F20\u957F\u5EA6\u5934\u8D8A\u754C`);
    const len = readU32(blob, pos);
    const nl = blob[pos + 4];
    pos += 5;
    if (nl < 1 || nl > NAME_MAX2) throw new CipkError(`\u7B2C ${idx + 1} \u5F20\u540D\u5B57\u957F\u5EA6\u975E\u6CD5: ${nl}`);
    if (pos + nl > blob.length) throw new CipkError(`\u7B2C ${idx + 1} \u5F20\u540D\u5B57\u8D8A\u754C`);
    const name = new TextDecoder("ascii").decode(blob.subarray(pos, pos + nl));
    if (!NAME_RE.test(name)) throw new CipkError(`\u7B2C ${idx + 1} \u5F20\u540D\u5B57\u4E0D\u5408\u89C4: ${name}`);
    pos += nl;
    if (pos + len > blob.length) throw new CipkError(`\u7B2C ${idx + 1} \u5F20\u6570\u636E\u8D8A\u754C`);
    out.push([name, blob.slice(pos, pos + len)]);
    pos += len;
  }
  if (pos !== blob.length) throw new CipkError(`\u5BB9\u5668\u5C3E\u90E8\u591A\u51FA ${blob.length - pos} \u5B57\u8282`);
  return out;
}
var CIPK_MAGIC, NAME_MAX2, ICON_LEN_MAX, COUNT_MAX, NAME_RE, enc, CipkError;
var init_cipk = __esm({
  "src/lib/pack/cipk.ts"() {
    "use strict";
    init_shellWriter();
    CIPK_MAGIC = "CIPK";
    NAME_MAX2 = 24;
    ICON_LEN_MAX = 524288;
    COUNT_MAX = 64;
    NAME_RE = /^[A-Za-z0-9_]+\.bin$/;
    enc = new TextEncoder();
    CipkError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "CipkError";
      }
    };
  }
});

// src/lib/icon/lvglIconCodec.ts
function lvglHeader(w, h, cf, flags, stride) {
  const out = new Uint8Array(12);
  out[0] = 25;
  out[1] = cf & 255;
  const dv = new DataView(out.buffer);
  dv.setUint16(2, flags & 65535, true);
  dv.setUint16(4, w & 65535, true);
  dv.setUint16(6, h & 65535, true);
  dv.setUint16(8, stride & 65535, true);
  dv.setUint16(10, 0, true);
  return out;
}
function bgra(pixels, w, h) {
  if (pixels.length !== w * h) throw new Error("\u50CF\u7D20\u6570\u4E0E\u5C3A\u5BF8\u4E0D\u5339\u914D");
  const out = new Uint8Array(12 + pixels.length * 4);
  out.set(lvglHeader(w, h, 16, 0, w * 4), 0);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < pixels.length; i++) {
    dv.setUint32(12 + i * 4, pixels[i] >>> 0, true);
  }
  return out;
}
function channel(color, ch) {
  return color >>> ch * 8 & 255;
}
function indexedRle(pixels, w, h) {
  if (!(w > 0 && h > 0) || pixels.length !== w * h) throw new Error("\u50CF\u7D20\u6570\u4E0E\u5C3A\u5BF8\u4E0D\u5339\u914D");
  const histogram = /* @__PURE__ */ new Map();
  for (const p of pixels) {
    if (p >>> 24 !== 0) histogram.set(p, (histogram.get(p) ?? 0) + 1);
  }
  let palette;
  if (histogram.size <= 255) {
    palette = [...histogram.keys()].sort((a, b) => a - b);
  } else {
    const boxes = [new Box([...histogram.entries()].map(([color, count2]) => ({ color, count: count2 })))];
    while (boxes.length < 255) {
      let index = -1;
      let best = -Infinity;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].score > best) {
          best = boxes[i].score;
          index = i;
        }
      }
      if (index < 0 || boxes[index].score < 0) break;
      const [a, b] = boxes[index].split();
      boxes.splice(index, 1, a, b);
    }
    palette = boxes.map((b) => b.mean());
  }
  const lookup = /* @__PURE__ */ new Map();
  for (const color of histogram.keys()) {
    let bestIdx = 0;
    let bestErr = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const candidate = palette[i];
      const alpha = channel(color, 3);
      const ca = channel(candidate, 3);
      let error = (alpha - ca) * (alpha - ca) * 2;
      for (let ch = 0; ch <= 2; ch++) {
        const delta = Math.trunc(
          (channel(color, ch) * alpha - channel(candidate, ch) * ca) / 255
        );
        error += delta * delta;
      }
      if (error < bestErr) {
        bestErr = error;
        bestIdx = i;
      }
    }
    lookup.set(color, bestIdx + 1);
  }
  const raw = new Uint8Array(1024 + pixels.length);
  const rdv = new DataView(raw.buffer);
  rdv.setUint32(0, 0, true);
  for (let i = 0; i < 255; i++) {
    rdv.setUint32(4 + i * 4, i < palette.length ? palette[i] >>> 0 : 0, true);
  }
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    raw[1024 + i] = p >>> 24 === 0 ? 0 : lookup.get(p);
  }
  const compressed = rle(raw);
  const out = new Uint8Array(12 + 12 + compressed.length);
  out.set(lvglHeader(w, h, 10, 8, w), 0);
  const odv = new DataView(out.buffer, 12);
  odv.setUint32(0, 1, true);
  odv.setUint32(4, compressed.length, true);
  odv.setUint32(8, raw.length, true);
  out.set(compressed, 24);
  return out;
}
function rle(raw) {
  const chunks = [];
  let total = 0;
  let at = 0;
  const run = (start) => {
    let n = 1;
    while (n < 127 && start + n < raw.length && raw[start + n] === raw[start]) n++;
    return n;
  };
  while (at < raw.length) {
    const count2 = run(at);
    if (count2 >= 3) {
      const piece = new Uint8Array(2);
      piece[0] = count2;
      piece[1] = raw[at];
      chunks.push(piece);
      total += 2;
      at += count2;
    } else {
      const begin = at;
      at += count2;
      while (at < raw.length && at - begin < 127 && run(at) < 3) {
        at += Math.min(run(at), 127 - (at - begin));
      }
      const n = at - begin;
      const piece = new Uint8Array(1 + n);
      piece[0] = 128 | n;
      piece.set(raw.subarray(begin, at), 1);
      chunks.push(piece);
      total += 1 + n;
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
function decode(bin) {
  if (bin.length < 12 || (bin[0] & 255) !== 25) throw new Error("\u56FE\u50CF\u5934\u4E0D\u5408\u6CD5");
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const cf = bin[1] & 255;
  const flags = dv.getUint16(2, true);
  const w = dv.getUint16(4, true);
  const h = dv.getUint16(6, true);
  const stride = dv.getUint16(8, true);
  if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) throw new Error("\u5C3A\u5BF8\u8D8A\u754C");
  if (cf === 16 && flags === 0) {
    if (!(stride >= w * 4 && bin.length === 12 + stride * h)) throw new Error("BGRA \u957F\u5EA6\u4E0D\u7B26");
    const pixels2 = new Uint32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      pixels2[i] = dv.getUint32(12 + Math.floor(i / w) * stride + i % w * 4, true) >>> 0;
    }
    return { width: w, height: h, pixels: pixels2 };
  }
  if (!(cf === 10 && flags === 8 && stride >= w && bin.length >= 24)) throw new Error("\u56FE\u50CF\u7F16\u7801\u4E0D\u652F\u6301");
  if (!(dv.getUint32(12, true) === 1 && dv.getUint32(16, true) === bin.length - 24 && dv.getUint32(20, true) === 1024 + stride * h)) {
    throw new Error("I8/RLE \u5934\u957F\u5EA6\u5B57\u6BB5\u4E0D\u7B26");
  }
  const raw = new Uint8Array(dv.getUint32(20, true));
  let at = 24;
  let dst = 0;
  while (at < bin.length) {
    const tag = bin[at++];
    const count2 = tag & 127;
    if (!(count2 > 0 && dst + count2 <= raw.length)) throw new Error("RLE \u8BA1\u6570\u8D8A\u754C");
    if ((tag & 128) !== 0) {
      if (at + count2 > bin.length) throw new Error("RLE \u5B57\u9762\u91CF\u8D8A\u754C");
      raw.set(bin.subarray(at, at + count2), dst);
      at += count2;
    } else {
      if (at >= bin.length) throw new Error("RLE \u91CD\u590D\u9879\u7F3A\u5931");
      raw.fill(bin[at++], dst, dst + count2);
    }
    dst += count2;
  }
  if (dst !== raw.length) throw new Error("RLE \u89E3\u538B\u957F\u5EA6\u4E0D\u7B26");
  const pdv = new DataView(raw.buffer);
  const pixels = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = raw[1024 + Math.floor(i / w) * stride + i % w];
    pixels[i] = pdv.getUint32(idx * 4, true) >>> 0;
  }
  return { width: w, height: h, pixels };
}
var Box;
var init_lvglIconCodec = __esm({
  "src/lib/icon/lvglIconCodec.ts"() {
    "use strict";
    init_shellWriter();
    Box = class _Box {
      constructor(colors) {
        this.colors = colors;
        this.ranges = [0, 1, 2, 3].map(
          (ch) => Math.max(...colors.map((c) => channel(c.color, ch))) - Math.min(...colors.map((c) => channel(c.color, ch)))
        );
        let best = 0;
        let bestScore = -Infinity;
        for (let ch = 0; ch < 4; ch++) {
          const s2 = this.ranges[ch] * (ch === 3 ? 2 : 1);
          if (ch === 0 || s2 > bestScore) {
            bestScore = s2;
            best = ch;
          }
        }
        this.splitChannel = best;
        this.score = colors.length > 1 ? this.ranges[this.splitChannel] * colors.reduce((s2, c) => s2 + c.count, 0) : -1;
      }
      colors;
      ranges;
      splitChannel;
      score;
      split() {
        const sorted = [...this.colors].sort(
          (a, b) => channel(a.color, this.splitChannel) - channel(b.color, this.splitChannel) || a.color - b.color
        );
        const half = Math.floor(sorted.reduce((s2, c) => s2 + c.count, 0) / 2);
        let sum = 0;
        let split = 1;
        for (let i = 0; i < sorted.length - 1; i++) {
          sum += sorted[i].count;
          split = i + 1;
          if (sum >= half) break;
        }
        return [new _Box(sorted.slice(0, split)), new _Box(sorted.slice(split))];
      }
      mean() {
        const total = this.colors.reduce((s2, c) => s2 + c.count, 0);
        let result = 0;
        for (let ch = 0; ch <= 3; ch++) {
          const value = Math.floor(
            (this.colors.reduce((s2, c) => s2 + channel(c.color, ch) * c.count, 0) + Math.floor(total / 2)) / total
          );
          result |= value << ch * 8;
        }
        return result >>> 0;
      }
    };
  }
});

// src/lib/icon/iconSpec.ts
var iconSpec_exports = {};
__export(iconSpec_exports, {
  ABSENT_ON_DEVICE: () => ABSENT_ON_DEVICE,
  CANVAS: () => CANVAS,
  CANVAS_HEADER: () => CANVAS_HEADER,
  CONTENT: () => CONTENT,
  CONTROL: () => CONTROL,
  DESKTOP: () => DESKTOP,
  GROUP_LABEL: () => GROUP_LABEL,
  MARGIN: () => MARGIN,
  OUT_BYTES: () => OUT_BYTES,
  SETTINGS: () => SETTINGS,
  SLOTS: () => SLOTS,
  devicePath: () => devicePath,
  duplicateStems: () => duplicateStems,
  exportIcons: () => exportIcons,
  matchName: () => matchName,
  previewStems: () => previewStems,
  slotCanvas: () => slotCanvas,
  slotContent: () => slotContent,
  slots: () => slots,
  stemOf: () => stemOf
});
function slotCanvas(slot) {
  return slot.group === "DESKTOP" ? CANVAS : 64;
}
function slotContent(slot) {
  return slot.group === "DESKTOP" ? CONTENT : 64;
}
function stemOf(stem) {
  return SLOTS.find((it) => it.stem === stem);
}
function slots(group2) {
  return SLOTS.filter((it) => it.group === group2);
}
function previewStems(stem) {
  return stem === "perpetual_calendar" ? ["calendar_background"] : [stem];
}
function matchName(base) {
  const name = base.trim();
  const byStem = stemOf(name.toLowerCase());
  if (byStem) return byStem;
  const hits = SLOTS.filter((slot) => {
    if (slot.label === name) return true;
    return ["_", "-", "\xB7", " "].some((sep) => name === GROUP_LABEL[slot.group] + sep + slot.label);
  });
  return hits.length === 1 ? hits[0] : void 0;
}
function duplicateStems(stems) {
  const counts = /* @__PURE__ */ new Map();
  for (const v of stems) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
}
function exportIcons(picked2) {
  const normalized = /* @__PURE__ */ new Map();
  for (const [stem, bin] of picked2) {
    const slot = stemOf(stem);
    if (!slot) throw new Error(`\u672A\u77E5\u56FE\u6807\u69FD\u4F4D: ${stem}`);
    if (normalized.has(slot.stem)) throw new Error(`\u56FE\u6807\u69FD\u4F4D\u91CD\u590D: ${slot.label}`);
    const decoded = decode(bin);
    if (decoded.width !== slotCanvas(slot) || decoded.height !== slotCanvas(slot)) {
      throw new Error(`${slot.label}\u5C3A\u5BF8\u4E0D\u5339\u914D`);
    }
    normalized.set(slot.stem, bin);
  }
  const out = [...normalized.entries()].map(([k, v]) => icon(k, v));
  const disturb = normalized.get("ctrl_disturb");
  if (disturb) {
    const image = decode(disturb);
    const canvas = new Uint32Array(160 * 124);
    for (let y = 0; y < 64; y++) {
      canvas.set(image.pixels.subarray(y * 64, y * 64 + 64), (y + 30) * 160 + 48);
    }
    out.push(icon("ctrl_dnd", indexedRle(canvas, 160, 124)));
  }
  return out.sort((a, b) => a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0);
}
function devicePath(stem) {
  return `/data/chaos/icons/${stem}.bin`;
}
var CANVAS, CONTENT, MARGIN, OUT_BYTES, CANVAS_HEADER, GROUP_LABEL, s, ABSENT_ON_DEVICE, DESKTOP, CONTROL, SETTINGS, SLOTS;
var init_iconSpec = __esm({
  "src/lib/icon/iconSpec.ts"() {
    "use strict";
    init_cipk();
    init_lvglIconCodec();
    CANVAS = 112;
    CONTENT = 100;
    MARGIN = (CANVAS - CONTENT) / 2;
    OUT_BYTES = 12 + CANVAS * CANVAS * 4;
    CANVAS_HEADER = (() => {
      const h = new Uint8Array(12);
      h[0] = 25;
      h[1] = 16;
      const dv = new DataView(h.buffer);
      dv.setUint16(4, CANVAS, true);
      dv.setUint16(6, CANVAS, true);
      dv.setUint16(8, CANVAS * 4, true);
      return h;
    })();
    GROUP_LABEL = {
      DESKTOP: "\u684C\u9762",
      CONTROL: "\u63A7\u5236\u4E2D\u5FC3",
      SETTINGS: "\u8BBE\u7F6E"
    };
    s = (stem, label, group2 = "DESKTOP") => ({ stem, label, group: group2 });
    ABSENT_ON_DEVICE = /* @__PURE__ */ new Set(["dealt", "innovation_research"]);
    DESKTOP = [
      s("activities", "\u6D3B\u529B\u6307\u6807"),
      s("aivs", "\u5C0F\u7231\u540C\u5B66"),
      s("alarm", "\u95F9\u949F"),
      s("alipay", "\u652F\u4ED8\u5B9D"),
      s("breath", "\u547C\u5438\u653E\u677E"),
      s("calendar", "\u65E5\u7A0B"),
      s("perpetual_calendar", "\u65E5\u5386"),
      s("camera", "\u9065\u63A7\u62CD\u7167"),
      s("card", "\u5361\u5305"),
      s("chronograph", "\u79D2\u8868"),
      s("compass", "\u6307\u5357\u9488"),
      s("findphone", "\u627E\u624B\u673A"),
      s("flashlight", "\u624B\u7535\u7B52"),
      s("heartrate", "\u5FC3\u7387"),
      s("interconnect", "\u591A\u7AEF\u8054\u52A8"),
      s("mijia", "\u7C73\u5BB6"),
      s("music", "\u97F3\u4E50"),
      s("mute", "\u624B\u673A\u9759\u97F3"),
      s("oxygen", "\u8840\u6C27"),
      s("pressure", "\u538B\u529B"),
      s("recorder", "\u5F55\u97F3\u673A"),
      s("settings", "\u8BBE\u7F6E"),
      s("share", "\u878D\u5408\u8BBE\u5907\u4E2D\u5FC3"),
      s("sleep", "\u7761\u7720"),
      s("sports", "\u8FD0\u52A8"),
      s("sports_course", "\u8DD1\u6B65\u8BFE\u7A0B"),
      s("sports_record", "\u8FD0\u52A8\u8BB0\u5F55"),
      s("sports_status", "\u8BAD\u7EC3\u72B6\u6001"),
      s("timer", "\u5012\u8BA1\u65F6"),
      s("todo", "\u5F85\u529E"),
      s("tomato_clock", "\u756A\u8304\u949F"),
      s("vitality", "\u5143\u6C14\u503C"),
      s("weather", "\u5929\u6C14"),
      s("womenhealth", "\u5973\u6027\u5065\u5EB7"),
      s("worldclock", "\u4E16\u754C\u65F6\u949F"),
      s("wxpay", "\u5FAE\u4FE1\u652F\u4ED8")
    ];
    CONTROL = [
      s("ctrl_flashlight", "\u624B\u7535\u7B52", "CONTROL"),
      s("ctrl_setting", "\u8BBE\u7F6E", "CONTROL"),
      s("ctrl_battery", "\u7701\u7535", "CONTROL"),
      s("ctrl_bright", "\u4EAE\u5EA6", "CONTROL"),
      s("ctrl_alarm", "\u95F9\u949F", "CONTROL"),
      s("ctrl_findphone", "\u627E\u624B\u673A", "CONTROL"),
      s("ctrl_disturb", "\u52FF\u6270", "CONTROL"),
      s("ctrl_raise", "\u62AC\u8155\u4EAE\u5C4F", "CONTROL"),
      s("ctrl_game", "\u6E38\u620F\u6A21\u5F0F", "CONTROL")
    ];
    SETTINGS = [
      s("set_notify", "\u901A\u77E5", "SETTINGS"),
      s("set_desktop", "\u684C\u9762", "SETTINGS"),
      s("set_display", "\u663E\u793A", "SETTINGS"),
      s("set_disturb", "\u52FF\u6270", "SETTINGS"),
      s("set_safe", "\u5B89\u5168", "SETTINGS"),
      s("set_battery", "\u7535\u6C60", "SETTINGS"),
      s("set_motion", "\u8FD0\u52A8", "SETTINGS"),
      s("set_preference", "\u504F\u597D", "SETTINGS"),
      s("set_mydevice", "\u6211\u7684\u8BBE\u5907", "SETTINGS"),
      s("set_wrist", "\u4F69\u6234\u65B9\u5F0F", "SETTINGS")
    ];
    SLOTS = [...DESKTOP, ...CONTROL, ...SETTINGS];
  }
});

// src/lib/icon/iconConvert.ts
var iconConvert_exports = {};
__export(iconConvert_exports, {
  ALPHA_HIT: () => ALPHA_HIT,
  ALPHA_PLATE: () => ALPHA_PLATE,
  BlankError: () => BlankError,
  NoPlateError: () => NoPlateError,
  PLATE_MIN_COVERAGE: () => PLATE_MIN_COVERAGE,
  convert: () => convert
});
function convert(src, w, h, slot) {
  if (slot.group !== "DESKTOP") return convertSystem(src, w, h, slot);
  if (!(w > 0 && h > 0) || src.length < w * h) throw new Error("\u50CF\u7D20\u6570\u7EC4\u4E0E\u5C3A\u5BF8\u4E0D\u5339\u914D");
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (src[row + x] >>> 24 > ALPHA_HIT) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new BlankError();
  let side = Math.max(x1 - x0, y1 - y0) + 1;
  side = Math.min(side, Math.min(w, h));
  const cx = Math.floor((x0 + x1 + 1) / 2);
  const cy = Math.floor((y0 + y1 + 1) / 2);
  const bx = Math.max(0, Math.min(cx - Math.floor(side / 2), w - side));
  const by = Math.max(0, Math.min(cy - Math.floor(side / 2), h - side));
  let opaque = 0;
  for (let y = by; y < by + side; y++) {
    const row = y * w;
    for (let x = bx; x < bx + side; x++) {
      if (src[row + x] >>> 24 > ALPHA_PLATE) opaque++;
    }
  }
  const coverage = opaque / (side * side);
  if (coverage <= PLATE_MIN_COVERAGE) throw new NoPlateError(coverage);
  const fitted = scaleBox(src, w, bx, by, side, CONTENT);
  const canvas = new Uint32Array(CANVAS * CANVAS);
  const off = MARGIN;
  for (let y = 0; y < CONTENT; y++) {
    const srcRow = y * CONTENT;
    const dstRow = (y + off) * CANVAS + off;
    canvas.set(fitted.subarray(srcRow, srcRow + CONTENT), dstRow);
  }
  return [packDesktop(canvas), { coverage, srcBoxSide: side, scaled: CONTENT }];
}
function convertSystem(src, w, h, slot) {
  if (!(w > 0 && h > 0) || src.length < w * h) throw new Error("\u50CF\u7D20\u6570\u7EC4\u4E0E\u5C3A\u5BF8\u4E0D\u5339\u914D");
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] >>> 24 !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new BlankError();
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const square = new Uint32Array(side * side);
  const dx = Math.floor((side - (x1 - x0 + 1)) / 2);
  const dy = Math.floor((side - (y1 - y0 + 1)) / 2);
  for (let y = y0; y <= y1; y++) {
    square.set(
      src.subarray(y * w + x0, y * w + x0 + (x1 - x0 + 1)),
      (y - y0 + dy) * side + dx
    );
  }
  const scaled = scaleBox(square, side, 0, 0, side, slotContent(slot));
  let opaque = 0;
  for (const p of square) if (p >>> 24 > ALPHA_PLATE) opaque++;
  const coverage = opaque / square.length;
  return [bgra(scaled, slotCanvas(slot), slotCanvas(slot)), { coverage, srcBoxSide: side, scaled: slotContent(slot) }];
}
function scaleBox(src, srcW, bx, by, side, dst) {
  if (side === dst) {
    const out2 = new Uint32Array(dst * dst);
    for (let y = 0; y < dst; y++) {
      out2.set(src.subarray((by + y) * srcW + bx, (by + y) * srcW + bx + dst), y * dst);
    }
    return out2;
  }
  const k = weights(side, dst);
  const horiz = new Float32Array(dst * side * 4);
  for (let y = 0; y < side; y++) {
    const row = (by + y) * srcW + bx;
    for (let x = 0; x < dst; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = x * k.n;
      for (let j = 0; j < k.n; j++) {
        const wgt = k.wgt[base + j];
        if (wgt === 0) continue;
        const p = src[row + k.idx[base + j]];
        const pa = p >>> 24 & 255;
        const f = wgt * pa;
        r += (p >>> 16 & 255) * f;
        g += (p >>> 8 & 255) * f;
        b += (p & 255) * f;
        a += f;
      }
      const o = (y * dst + x) * 4;
      horiz[o] = fround(r);
      horiz[o + 1] = fround(g);
      horiz[o + 2] = fround(b);
      horiz[o + 3] = fround(a);
    }
  }
  const out = new Uint32Array(dst * dst);
  for (let x = 0; x < dst; x++) {
    for (let y = 0; y < dst; y++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = y * k.n;
      for (let j = 0; j < k.n; j++) {
        const wgt = k.wgt[base + j];
        if (wgt === 0) continue;
        const o = (k.idx[base + j] * dst + x) * 4;
        r += horiz[o] * wgt;
        g += horiz[o + 1] * wgt;
        b += horiz[o + 2] * wgt;
        a += horiz[o + 3] * wgt;
      }
      const inv = a > 1e-6 ? 1 / a : 0;
      out[y * dst + x] = (clamp255(a) << 24 | clamp255(r * inv) << 16 | clamp255(g * inv) << 8 | clamp255(b * inv)) >>> 0;
    }
  }
  return out;
}
function clamp255(v) {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(v + 0.5);
}
function weights(size, dst) {
  const scale = size / dst;
  const filterScale = Math.max(1, scale);
  const support = LANCZOS_A * filterScale;
  const n = Math.floor(2 * support) + 3;
  const idx = new Int32Array(dst * n);
  const wgt = new Float32Array(dst * n);
  for (let ox = 0; ox < dst; ox++) {
    const c = (ox + 0.5) * scale - 0.5;
    const lo = Math.ceil(c - support);
    const hi = Math.floor(c + support);
    let sum = 0;
    let j = 0;
    for (let i = lo; i <= hi; i++) {
      if (j >= n) break;
      const w = lanczos((i - c) / filterScale);
      idx[ox * n + j] = Math.max(0, Math.min(i, size - 1));
      wgt[ox * n + j] = fround(w);
      sum += w;
      j++;
    }
    if (sum !== 0 && sum !== 1) {
      const inv = 1 / sum;
      for (let q = 0; q < j; q++) wgt[ox * n + q] = fround(wgt[ox * n + q] * inv);
    }
  }
  return { idx, wgt, n };
}
function lanczos(x) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= LANCZOS_A) return 0;
  const px = Math.PI * x;
  return LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A) / (px * px);
}
function packDesktop(argb) {
  const out = new Uint8Array(OUT_BYTES);
  out.set(CANVAS_HEADER, 0);
  const dv = new DataView(out.buffer);
  let o = CANVAS_HEADER.length;
  for (const p of argb) {
    dv.setUint32(o, p >>> 0, true);
    o += 4;
  }
  return out;
}
var ALPHA_HIT, ALPHA_PLATE, PLATE_MIN_COVERAGE, LANCZOS_A, BlankError, NoPlateError, fround;
var init_iconConvert = __esm({
  "src/lib/icon/iconConvert.ts"() {
    "use strict";
    init_iconSpec();
    init_lvglIconCodec();
    ALPHA_HIT = 24;
    ALPHA_PLATE = 200;
    PLATE_MIN_COVERAGE = 0.55;
    LANCZOS_A = 3;
    BlankError = class extends Error {
      constructor() {
        super("\u8FD9\u5F20\u56FE\u6574\u5E45\u90FD\u662F\u900F\u660E\u7684\uFF0C\u6CA1\u6709\u53EF\u7528\u7684\u5185\u5BB9");
        this.name = "BlankError";
      }
    };
    NoPlateError = class extends Error {
      constructor(coverage) {
        super(
          `\u8FD9\u5F20\u56FE\u6CA1\u6709\u5E95\u677F\uFF08\u5185\u5BB9\u53EA\u5360\u65B9\u6846\u7684 ${Math.round(coverage * 100)}%\uFF09\uFF0C\u8D34\u5230\u684C\u9762\u4F1A\u6BD4\u7CFB\u7EDF\u56FE\u6807\u5C0F\u4E00\u5708\u3002\u8BF7\u6362\u4E00\u5F20\u81EA\u5E26\u5E95\u8272\u7684\u56FE\u3002`
        );
        this.coverage = coverage;
        this.name = "NoPlateError";
      }
      coverage;
    };
    fround = (v) => Math.fround(v);
  }
});

// src/lib/pack/titleText.ts
function width(s2) {
  let w = 0;
  let i = 0;
  while (i < s2.length) {
    const cp = s2.codePointAt(i);
    w += isWide(cp) ? 2 : 1;
    i += cp > 65535 ? 2 : 1;
  }
  return w;
}
function validate(s2) {
  const t = s2.trim();
  if (t.length === 0) return "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A";
  const w = width(t);
  if (w > MAX_HALF) {
    return `\u6807\u9898\u592A\u5BBD: \u5F53\u524D ${w} \u4E2A\u534A\u89D2, \u624B\u73AF\u4E0A\u6700\u591A ${MAX_HALF} \u4E2A\u534A\u89D2(\u4E00\u4E2A\u6C49\u5B57\u7B97 2 \u4E2A),\u8D85\u51FA\u7684\u90E8\u5206\u4F1A\u6298\u884C\u6216\u88AB\u622A\u65AD`;
  }
  return null;
}
function isWide(cp) {
  return cp >= 4352 && cp <= 4447 || cp >= 11904 && cp <= 12350 || cp >= 12353 && cp <= 13311 || cp >= 13312 && cp <= 19903 || cp >= 19968 && cp <= 40959 || cp >= 40960 && cp <= 42191 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65040 && cp <= 65049 || cp >= 65072 && cp <= 65135 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510;
}
var MAX_HALF;
var init_titleText = __esm({
  "src/lib/pack/titleText.ts"() {
    "use strict";
    MAX_HALF = 16;
  }
});

// src/lib/pack/packBuilders.ts
var packBuilders_exports = {};
__export(packBuilders_exports, {
  FONT_LABEL_BYTES: () => FONT_LABEL_BYTES,
  PH_FONT_NAME: () => PH_FONT_NAME,
  PH_PACK_LABEL: () => PH_PACK_LABEL,
  PH_PACK_NAME: () => PH_PACK_NAME,
  PH_PACK_TITLE: () => PH_PACK_TITLE,
  SHORT_BYTES: () => SHORT_BYTES,
  buildFontPack: () => buildFontPack,
  buildIconPack: () => buildIconPack,
  luaQuote: () => luaQuote,
  patchLua: () => patchLua
});
function buildFontPack(a, inputs, preview) {
  const labelBytes = encodeUtf8(inputs.label);
  if (labelBytes.length === 0 || labelBytes.length > FONT_LABEL_BYTES) {
    throw new PackError(`\u5B57\u4F53\u77ED\u540D\u8981\u5728 1..${FONT_LABEL_BYTES} \u5B57\u8282\u4E4B\u95F4: \u300C${inputs.label}\u300D`);
  }
  for (const ch of inputs.label) {
    if (ch.codePointAt(0) < 32) throw new PackError("\u5B57\u4F53\u77ED\u540D\u4E0D\u80FD\u6709\u63A7\u5236\u5B57\u7B26");
  }
  validate(inputs.title);
  const lua = patchLua(a.fontLua, /* @__PURE__ */ new Map([
    [PH_FONT_NAME, inputs.label],
    [PH_PACK_LABEL, inputs.label],
    [PH_PACK_TITLE, inputs.title]
  ]));
  const entries = [
    entry("_lua/fontpack/main.lua", utf8Enc2.encode(lua)),
    entry("_lua/fontpack/chaos_sup.ko", a.ko),
    entry("_lua/fontpack/chaos_icon.bin", a.iconBin),
    entry("_lua/fontpack/font.ttf", inputs.font)
  ];
  if (inputs.pkgName !== null) checkPkg(inputs.pkgName);
  const pkg = inputs.pkgName ?? pkgFor(inputs.font);
  const out = build(entries, pkg, inputs.packName, preview);
  verifyBuilt(out, pkg, inputs.packName, entries);
  checkPackedLua(out, 1, [PH_FONT_NAME, PH_PACK_LABEL, PH_PACK_TITLE], inputs.label);
  return { bytes: out, pkgName: pkg, packName: inputs.packName };
}
function checkPackedLua(out, idx, placeholders, label) {
  const [path, data] = readEntry(out, idx);
  if (!path.endsWith("main.lua")) throw new PackError(`\u7B2C ${idx} \u69FD\u4E0D\u662F\u6295\u9012 Lua: ${path}`);
  const txt = decodeUtf8(data);
  for (const ph of placeholders) {
    if (txt.includes(ph)) throw new PackError(`\u6295\u9012 Lua \u91CC\u8FD8\u7559\u7740 ${ph} \u5360\u4F4D\u7B26`);
  }
  if (!txt.includes(`local FONT_NAME = "${label}"`)) {
    throw new PackError(`\u6295\u9012 Lua \u91CC\u7684\u77ED\u540D\u4E0D\u662F\u300C${label}\u300D`);
  }
}
function buildIconPack(a, inputs, preview) {
  const sb = utf8Enc2.encode(inputs.short);
  if (sb.length === 0 || sb.length > SHORT_BYTES) {
    throw new PackError(`\u56FE\u6807\u5305\u77ED\u540D\u8981\u5728 1..${SHORT_BYTES} \u5B57\u8282\u4E4B\u95F4`);
  }
  for (const ch of inputs.short) {
    const c = ch.codePointAt(0);
    if (c <= 32 || c >= 127) {
      throw new PackError(`\u56FE\u6807\u5305\u77ED\u540D\u53EA\u80FD\u662F\u53EF\u6253\u5370 ASCII: \u300C${inputs.short}\u300D`);
    }
  }
  const cipk = buildCipk(inputs.icons);
  const lua = patchLua(a.iconLua, /* @__PURE__ */ new Map([
    [PH_PACK_NAME, inputs.short],
    [PH_PACK_TITLE, inputs.title]
  ]));
  const entries = [
    entry("_lua/iconpack/main.lua", utf8Enc2.encode(lua)),
    entry("_lua/iconpack/chaos_sup.ko", a.ko),
    entry("_lua/iconpack/chaos_icon.bin", a.iconBin),
    entry("_lua/iconpack/pack.bin", cipk)
  ];
  if (inputs.pkgName !== null) checkPkg(inputs.pkgName);
  const pkg = inputs.pkgName ?? pkgFor(cipk);
  const out = build(entries, pkg, inputs.packName, preview);
  verifyBuilt(out, pkg, inputs.packName, entries);
  const [luaPath, luaData] = readEntry(out, 1);
  if (!luaPath.endsWith("main.lua")) throw new PackError("\u7B2C 1 \u69FD\u4E0D\u662F\u6295\u9012 Lua");
  const txt = decodeUtf8(luaData);
  for (const ph of [PH_PACK_NAME, PH_PACK_TITLE]) {
    if (txt.includes(ph)) throw new PackError(`\u6295\u9012 Lua \u91CC\u8FD8\u7559\u7740 ${ph} \u5360\u4F4D\u7B26`);
  }
  if (!txt.includes(inputs.short)) throw new PackError(`\u6295\u9012 Lua \u91CC\u6CA1\u627E\u5230\u77ED\u540D\u300C${inputs.short}\u300D`);
  const [packPath, packData] = readEntry(out, 4);
  if (!packPath.endsWith("pack.bin")) throw new PackError(`\u7B2C 4 \u69FD\u4E0D\u662F CIPK: ${packPath}`);
  if (!bytesEqual(packData, cipk)) throw new PackError("pack.bin \u4E0E\u672C\u6B21\u751F\u6210\u7684\u5BB9\u5668\u4E0D\u4E00\u81F4");
  const back = parseCipk(packData);
  if (back.length !== inputs.icons.length) throw new PackError("CIPK \u89E3\u56DE\u6765\u5F20\u6570\u4E0D\u5BF9");
  back.forEach(([name, data], i) => {
    const ic = inputs.icons[i];
    if (name !== `${ic.stem}.bin`) throw new PackError(`\u7B2C ${i + 1} \u5F20\u540D\u5B57\u5BF9\u4E0D\u4E0A: ${name}`);
    if (!bytesEqual(data, ic.data)) throw new PackError(`${name} \u5185\u5BB9\u4E0D\u4E00\u81F4`);
  });
  return { bytes: out, pkgName: pkg, packName: inputs.packName, iconCount: back.length };
}
function patchLua(src, map) {
  const norm = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const [ph] of map) {
    const n = countOccurrences(norm, ph);
    if (n !== 1) throw new PackError(`\u6295\u9012 Lua \u91CC ${ph} \u5E94\u6070\u597D\u51FA\u73B0 1 \u6B21, \u5B9E\u9645 ${n} \u6B21`);
  }
  let out = norm;
  for (const [ph, v] of map) out = out.replace(ph, luaQuote(v));
  return out;
}
function countOccurrences(s2, sub) {
  let n = 0;
  let i = s2.indexOf(sub);
  while (i >= 0) {
    n++;
    i = s2.indexOf(sub, i + sub.length);
  }
  return n;
}
function luaQuote(s2) {
  let out = "";
  for (const ch of s2) {
    const c = ch.codePointAt(0);
    if (ch === '"' || ch === "\\") out += "\\" + ch;
    else if (c < 32) out += "\\" + c;
    else out += ch;
  }
  return out;
}
var utf8Enc2, FONT_LABEL_BYTES, PH_FONT_NAME, PH_PACK_LABEL, PH_PACK_TITLE, SHORT_BYTES, PH_PACK_NAME;
var init_packBuilders = __esm({
  "src/lib/pack/packBuilders.ts"() {
    "use strict";
    init_shellWriter();
    init_shellBuilder();
    init_cipk();
    init_titleText();
    init_shellBuilder();
    utf8Enc2 = new TextEncoder();
    FONT_LABEL_BYTES = 12;
    PH_FONT_NAME = "__FONT_NAME__";
    PH_PACK_LABEL = "__PACK_LABEL__";
    PH_PACK_TITLE = "__PACK_TITLE__";
    SHORT_BYTES = 12;
    PH_PACK_NAME = "__PACK_NAME__";
  }
});

// src/lib/pack/previewFactory.ts
var previewFactory_exports = {};
__export(previewFactory_exports, {
  PREVIEW_H: () => PREVIEW_H,
  PREVIEW_W: () => PREVIEW_W,
  decodePreview: () => decodePreview,
  encodePreview: () => encodePreview,
  imageDataPreview: () => imageDataPreview,
  rleEncode: () => rleEncode
});
function qkey(r, g, b) {
  return r >>> 3 << 12 | g >>> 3 << 6 | b >>> 3;
}
function rleEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    let j = i;
    while (j < data.length && data[j] === data[i]) j++;
    let run = j - i;
    if (run >= 3) {
      while (run) {
        const n = Math.min(run, 127);
        out.push(n, data[i]);
        run -= n;
        i += n;
      }
    } else {
      const s2 = i;
      let k = i;
      while (k < data.length && k - s2 < 127) {
        if (k + 2 < data.length && data[k] === data[k + 1] && data[k] === data[k + 2]) break;
        k++;
      }
      out.push(128 | k - s2, ...data.subarray(s2, k));
      i = k;
    }
  }
  return Uint8Array.from(out);
}
function encodePreview(indices, palette, w = PREVIEW_W, h = PREVIEW_H) {
  if (indices.length !== w * h || palette.length !== 1024) throw new Error("\u9884\u89C8\u50CF\u7D20\u6216\u8C03\u8272\u677F\u957F\u5EA6\u4E0D\u7B26");
  const raw = new Uint8Array(1024 + indices.length);
  raw.set(palette);
  raw.set(indices, 1024);
  const stream = rleEncode(raw), out = new Uint8Array(20 + stream.length), dv = new DataView(out.buffer);
  dv.setUint8(0, 16);
  dv.setUint8(1, 4);
  dv.setUint16(2, 0, true);
  dv.setUint16(4, w, true);
  dv.setUint16(6, h, true);
  dv.setUint32(8, stream.length + 8, true);
  dv.setUint32(12, MAGIC2, true);
  dv.setUint32(16, (1 | (raw.length & 16777215) << 4) >>> 0, true);
  out.set(stream, 20);
  return out;
}
function decodePreview(blob) {
  if (blob.length < 20 || blob[0] !== 16 || blob[1] !== 4) throw new Error("\u4E0D\u662F\u5C0F\u7C73\u9884\u89C8 RLE \u5757");
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), w = dv.getUint16(4, true), h = dv.getUint16(6, true), len = dv.getUint32(8, true);
  if (dv.getUint32(12, true) !== MAGIC2) throw new Error("\u9884\u89C8\u9B54\u6570\u4E0D\u7B26");
  const meta = dv.getUint32(16, true), total = meta >>> 4;
  if ((meta & 15) !== 1 || total !== 1024 + w * h) throw new Error("\u9884\u89C8\u957F\u5EA6\u4E0D\u7B26");
  const raw = new Uint8Array(total);
  let i = 20, o = 0;
  while (o < total) {
    const c = blob[i++];
    if (c < 128) {
      const n = c;
      raw.fill(blob[i++], o, o + n);
      o += n;
    } else {
      const n = c & 127;
      raw.set(blob.subarray(i, i + n), o);
      i += n;
      o += n;
    }
  }
  if (o !== total || i !== blob.length) throw new Error("\u9884\u89C8 RLE \u6D41\u635F\u574F");
  return { w, h, palette: raw.slice(0, 1024), indices: raw.slice(1024) };
}
function imageDataPreview(image) {
  if (image.width !== PREVIEW_W || image.height !== PREVIEW_H) throw new Error(`\u9884\u89C8\u5C3A\u5BF8\u5FC5\u987B\u662F ${PREVIEW_W}x${PREVIEW_H}`);
  const counts = /* @__PURE__ */ new Map(), reps = /* @__PURE__ */ new Map(), p = image.data;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    if (a < 16) continue;
    const k = qkey(p[i], p[i + 1], p[i + 2]);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!reps.has(k)) reps.set(k, [p[i], p[i + 1], p[i + 2]]);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => reps.get(k));
  const must = [[28, 28, 30], [42, 130, 228], [255, 195, 0]];
  for (const c of must) if (!colors.some((x) => x[0] === c[0] && x[1] === c[1] && x[2] === c[2])) colors.push(c);
  if (colors.length > 255) throw new Error("\u9884\u89C8\u8C03\u8272\u677F\u8D85\u8FC7 256 \u8272");
  const pal = new Uint8Array(1024);
  const map = /* @__PURE__ */ new Map();
  colors.forEach((c, i) => {
    pal[(i + 1) * 4] = c[2];
    pal[(i + 1) * 4 + 1] = c[1];
    pal[(i + 1) * 4 + 2] = c[0];
    pal[(i + 1) * 4 + 3] = 255;
    map.set(qkey(...c), i + 1);
  });
  const idx = new Uint8Array(PREVIEW_W * PREVIEW_H);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    if (p[i + 3] >= 16) idx[j] = map.get(qkey(p[i], p[i + 1], p[i + 2]));
  }
  return encodePreview(idx, pal);
}
var PREVIEW_W, PREVIEW_H, MAGIC2;
var init_previewFactory = __esm({
  "src/lib/pack/previewFactory.ts"() {
    "use strict";
    PREVIEW_W = 336;
    PREVIEW_H = 480;
    MAGIC2 = 1520771552;
  }
});

// src/scripts_icons.ts
var grid = document.querySelector("#grid");
var count = document.querySelector("#count");
var status = document.querySelector("#status");
var group = "DESKTOP";
var picked = /* @__PURE__ */ new Map();
var replacementUrls = /* @__PURE__ */ new Map();
var alphabet = "0123456789";
function randomId() {
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
document.querySelector("#random-id").onclick = () => {
  document.querySelector("#pkg").value = randomId();
};
var slots2 = { DESKTOP: ["activities", "aivs", "alarm", "alipay", "breath", "calendar", "perpetual_calendar", "camera", "card", "chronograph", "compass", "findphone", "flashlight", "heartrate", "interconnect", "mijia", "music", "mute", "oxygen", "pressure", "recorder", "settings", "share", "sleep", "sports", "sports_course", "sports_record", "sports_status", "timer", "todo", "tomato_clock", "vitality", "weather", "womenhealth", "worldclock", "wxpay"], CONTROL: ["ctrl_flashlight", "ctrl_setting", "ctrl_battery", "ctrl_bright", "ctrl_alarm", "ctrl_findphone", "ctrl_disturb", "ctrl_raise", "ctrl_game"], SETTINGS: ["set_notify", "set_desktop", "set_display", "set_disturb", "set_safe"] };
function render() {
  grid.innerHTML = "";
  for (const stem of slots2[group]) {
    const el = document.createElement("div");
    el.className = "slot" + (picked.has(stem) ? " selected" : "");
    el.dataset.stem = stem;
    const img = document.createElement("img");
    const previewStem = stem === "perpetual_calendar" ? "calendar_background" : stem;
    img.src = replacementUrls.get(stem) || `/stock_icons/${previewStem}.png`;
    img.alt = stem;
    img.onerror = () => {
      img.style.display = "none";
    };
    el.append(img);
    const row = document.createElement("div");
    row.className = "slot-row";
    const label = document.createElement("small");
    label.textContent = stem;
    row.append(label);
    const actions = document.createElement("div");
    actions.className = "slot-actions";
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "slot-action replace";
    replace.textContent = "\u9009\u62E9\u66FF\u6362\u56FE\u6807";
    replace.onclick = (ev) => {
      ev.stopPropagation();
      chooseReplacement(stem);
    };
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "slot-action";
    restore.textContent = "\u590D\u539F\u5B98\u65B9\u56FE\u6807";
    restore.onclick = (ev) => {
      ev.stopPropagation();
      picked.delete(stem);
      replacementUrls.delete(stem);
      status.textContent = `\u5DF2\u590D\u539F ${stem}`;
      update();
    };
    actions.append(replace, restore);
    row.append(actions);
    el.append(row);
    el.onclick = () => chooseReplacement(stem);
    img.onclick = (ev) => {
      ev.stopPropagation();
      chooseReplacement(stem);
    };
    grid.append(el);
  }
  count.textContent = picked.size;
}
function chooseReplacement(stem) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const bm = await createImageBitmap(file);
    const expected = stem.startsWith("ctrl_") || stem.startsWith("set_") ? 64 : 112;
    if (bm.width !== expected || bm.height !== expected) {
      status.textContent = `${stem} \u5FC5\u987B\u9009\u62E9 ${expected}\xD7${expected} PNG`;
      return;
    }
    const c = document.createElement("canvas");
    c.width = bm.width;
    c.height = bm.height;
    c.getContext("2d").drawImage(bm, 0, 0);
    picked.set(stem, c.getContext("2d").getImageData(0, 0, c.width, c.height));
    replacementUrls.set(stem, c.toDataURL("image/png"));
    status.textContent = `\u5DF2\u66FF\u6362 ${stem}`;
    update();
  };
  input.click();
}
function update() {
  count.textContent = picked.size;
  render();
  document.querySelector("#export").disabled = !picked.size;
}
for (const t of document.querySelectorAll(".tab")) t.onclick = () => {
  document.querySelector(".tab.active").classList.remove("active");
  t.classList.add("active");
  group = t.dataset.group;
  render();
};
document.querySelector("#clear").onclick = () => {
  if (!confirm(`\u786E\u5B9A\u6E05\u7A7A\u5F53\u524D\u201C${group === "DESKTOP" ? "\u684C\u9762" : group === "CONTROL" ? "\u63A7\u5236\u4E2D\u5FC3" : "\u8BBE\u7F6E"}\u201D\u9875\u9762\u7684\u5168\u90E8\u66FF\u6362\u56FE\u6807\u5E76\u6062\u590D\u5B98\u65B9\u56FE\u6807\u5417\uFF1F`)) return;
  for (const stem of slots2[group]) {
    picked.delete(stem);
    replacementUrls.delete(stem);
  }
  status.textContent = "\u5F53\u524D\u9875\u9762\u5DF2\u6062\u590D\u5B98\u65B9\u56FE\u6807";
  update();
};
render();
document.querySelector("#files").onchange = async (e) => {
  const { stemOf: stemOf2 } = await Promise.resolve().then(() => (init_iconSpec(), iconSpec_exports));
  let matched = 0;
  let rejected = 0;
  for (const file of e.target.files) {
    if (file.type && file.type !== "image/png") {
      rejected++;
      continue;
    }
    const raw = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    const slot = stemOf2(raw);
    if (!slot) {
      rejected++;
      continue;
    }
    const bm = await createImageBitmap(file);
    const expected = slot.group === "DESKTOP" ? 112 : 64;
    if (bm.width !== expected || bm.height !== expected) {
      rejected++;
      continue;
    }
    const c = document.createElement("canvas");
    c.width = bm.width;
    c.height = bm.height;
    c.getContext("2d").drawImage(bm, 0, 0);
    picked.set(slot.stem, c.getContext("2d").getImageData(0, 0, c.width, c.height));
    replacementUrls.set(slot.stem, c.toDataURL("image/png"));
    matched++;
  }
  if (!matched) {
    status.textContent = "\u8BF7\u4E0A\u4F20\u7B26\u5408\u540D\u79F0\u7684png\u56FE\u7247";
  } else {
    status.textContent = `\u5DF2\u5BFC\u5165 ${matched} \u5F20\u56FE\u6807${rejected ? `\uFF0C\u8DF3\u8FC7 ${rejected} \u5F20` : ""}`;
  }
  update();
};
async function assetText(name) {
  const r = await fetch(new URL("../pack/" + name, document.baseURI));
  return r.text();
}
async function assetBytes(name) {
  const r = await fetch(new URL("../pack/" + name, document.baseURI));
  return new Uint8Array(await r.arrayBuffer());
}
function save(b, n) {
  const a = document.createElement("a");
  const u = URL.createObjectURL(new Blob([b], { type: "application/octet-stream" }));
  a.href = u;
  a.download = n;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(u);
  }, 1e3);
}
document.querySelector("#export").onclick = async () => {
  try {
    status.textContent = "\u6B63\u5728\u751F\u6210\u2026";
    const { convert: convert2 } = await Promise.resolve().then(() => (init_iconConvert(), iconConvert_exports));
    const { exportIcons: exportIcons2 } = await Promise.resolve().then(() => (init_iconSpec(), iconSpec_exports));
    const { buildIconPack: buildIconPack2 } = await Promise.resolve().then(() => (init_packBuilders(), packBuilders_exports));
    const converted = /* @__PURE__ */ new Map();
    for (const [stem, image] of picked) {
      const p = image.data, px = new Uint32Array(image.width * image.height);
      for (let i = 0; i < px.length; i++) px[i] = p[i * 4 + 3] << 24 | p[i * 4] << 16 | p[i * 4 + 1] << 8 | p[i * 4 + 2];
      const slot = (await Promise.resolve().then(() => (init_iconSpec(), iconSpec_exports))).stemOf(stem);
      converted.set(stem, convert2(px, image.width, image.height, slot)[0]);
    }
    const icons = exportIcons2(converted);
    const { imageDataPreview: imageDataPreview2 } = await Promise.resolve().then(() => (init_previewFactory(), previewFactory_exports));
    const pc = document.createElement("canvas");
    pc.width = 336;
    pc.height = 480;
    const pctx = pc.getContext("2d");
    pctx.fillStyle = "#1c1c1e";
    pctx.fillRect(0, 0, 336, 480);
    pctx.fillStyle = "#f2f2f2";
    pctx.font = "40px sans-serif";
    pctx.textAlign = "center";
    pctx.fillText(document.querySelector("#title").value, 168, 90);
    const preview = imageDataPreview2(pctx.getImageData(0, 0, 336, 480));
    const out = buildIconPack2({ ko: await assetBytes("chaos_sup.ko"), iconBin: await assetBytes("chaos_icon.bin"), fontLua: "", iconLua: await assetText("icon_pack.lua") }, { short: document.querySelector("#short").value, packName: document.querySelector("#packname").value, title: document.querySelector("#title").value, pkgName: document.querySelector("#pkg").value || null, icons }, preview);
    save(out.bytes, out.pkgName + ".bin");
    status.textContent = `\u5DF2\u751F\u6210 ${out.iconCount} \u5F20\u56FE\u6807\uFF0C\u5305\u540D ${out.pkgName}`;
  } catch (e) {
    status.textContent = e.message || String(e);
  }
};
