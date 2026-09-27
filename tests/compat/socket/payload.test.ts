import { expect, test } from "vitest";
import { toPayload } from "../../../src/compat/socket/payload";

/// `ws` reads a binary container through its byte view. `Buffer.from(view)`
/// instead copies element by element and keeps one byte per element, so the
/// payload that reached the socket was a truncation rather than the caller's
/// bytes: a two-element `Uint16Array` was 2 bytes here and the 4 bytes `ws` puts
/// on the wire. The comparison is against `ws`'s own `toBuffer`, so the table
/// states the contract rather than a value this file invented.
const BINARY_CONTAINERS: ReadonlyArray<readonly [string, ArrayBufferView | ArrayBuffer]> = [
  ["a Buffer", Buffer.from([0x61, 0x62, 0x63])],
  ["an ArrayBuffer", new Uint8Array([0x61, 0x62, 0x63]).buffer],
  ["a Uint8Array", new Uint8Array([0x61, 0x62, 0x63])],
  ["a Uint8ClampedArray", new Uint8ClampedArray([0x61, 0x62, 0x63])],
  ["a Int8Array", new Int8Array([-1, 2, -3])],
  ["a Uint16Array", new Uint16Array([0x0161, 0x0162])],
  ["a Uint32Array", new Uint32Array([0x61616161])],
  ["a Float32Array", new Float32Array([1.5, -2.25])],
  ["a Float64Array", new Float64Array([1.5])],
  ["a DataView", new DataView(new Uint8Array([0x61, 0x62]).buffer)],
];

function wsBytes(data: ArrayBufferView | ArrayBuffer): Buffer {
  // `ws` normalizes with `toBuffer`; this is the same expression it uses, kept
  // local so the fixture depends on the rule rather than on a copied expectation.
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(data);
}

test.each(BINARY_CONTAINERS)("%s is read through its byte view", (_name, data) => {
  const { bytes, binary } = toPayload(data);
  expect(binary).toBe(true);
  expect(bytes.equals(wsBytes(data))).toBe(true);
});

test("a multi-byte typed array keeps every byte it holds", () => {
  // The regression this pins: 4 bytes, not 2.
  const { bytes } = toPayload(new Uint16Array([0x0161, 0x0162]));
  expect(bytes.length).toBe(4);
  expect(bytes.toString("hex")).toBe("61016201");
});

test("a typed array view honours its byteOffset", () => {
  const backing = new Uint8Array([0, 0, 0x61, 0x62, 0x63]);
  const view = new Uint8Array(backing.buffer, 2, 3);
  expect(toPayload(view).bytes.equals(Buffer.from([0x61, 0x62, 0x63]))).toBe(true);
});

/// `ws` stringifies a number before it decides binary-ness, so `send(0)` is the
/// text frame `"0"` and not the empty binary frame a falsy check would give.
test("numbers and strings are text, matching ws", () => {
  expect(toPayload(42)).toEqual({ bytes: Buffer.from("42", "utf8"), binary: false });
  expect(toPayload(0)).toEqual({ bytes: Buffer.from("0", "utf8"), binary: false });
  expect(toPayload("hello")).toEqual({ bytes: Buffer.from("hello", "utf8"), binary: false });
  expect(toPayload("")).toEqual({ bytes: Buffer.alloc(0), binary: false });
});

test("a falsy non-number payload is the empty binary buffer", () => {
  expect(toPayload(null)).toEqual({ bytes: Buffer.alloc(0), binary: true });
  expect(toPayload(undefined)).toEqual({ bytes: Buffer.alloc(0), binary: true });
  expect(toPayload(false)).toEqual({ bytes: Buffer.alloc(0), binary: true });
});

/// `Buffer.from` is the runtime enforcement of the BufferLike contract, and it
/// reads a length-bearing object as a zero-filled array of that length, which is
/// what `ws` reads it as.
test("a length-bearing object is read as a zero-filled array", () => {
  expect(toPayload({ length: 3 }).bytes.equals(Buffer.alloc(3))).toBe(true);
});

/// A value `Buffer.from` cannot read at all raises the same `TypeError` `ws`
/// raises, rather than a facade-specific one.
test("an unreadable value is refused the way ws refuses it", () => {
  expect(() => toPayload({})).toThrow(TypeError);
  expect(() => toPayload(true)).toThrow(TypeError);
});
