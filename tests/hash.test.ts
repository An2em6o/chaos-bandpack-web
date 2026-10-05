/**
 * 同步 SHA-256 的已知向量 + pkgFor 的口径(与 Kotlin MessageDigest 同一条路径)。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256 } from "../src/lib/hash/sha256";
import { pkgFor } from "../src/lib/pack/shellWriter";

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("sha256", () => {
  it("FIPS 已知向量", () => {
    expect(hex(sha256(new TextEncoder().encode("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      hex(sha256(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("跨 64 字节分块边界", () => {
    // 55/56/63/64 字节四种长度, 与 Node crypto 对拍
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256(data)), `len=${len}`).toBe(
        createHash("sha256").update(data).digest("hex"),
      );
    }
  });
});

describe("pkgFor", () => {
  it("12 位数字、4348 前缀、幂等", () => {
    const blob = new Uint8Array(1024).map((_, i) => i & 0xff);
    const pkg = pkgFor(blob);
    expect(pkg).toMatch(/^4348[0-9]{8}$/);
    expect(pkgFor(blob.slice())).toBe(pkg);
    expect(pkgFor(new Uint8Array(1))).not.toBe(pkg);
  });
});
