import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange } from "./range.js";
test("parses explicit and open-ended ranges", () => {
    assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseByteRange("bytes=95-", 100), { start: 95, end: 99 });
});
test("parses suffix ranges and clips their start to the file", () => {
    assert.deepEqual(parseByteRange("bytes=-20", 100), { start: 80, end: 99 });
    assert.deepEqual(parseByteRange("bytes=-200", 100), { start: 0, end: 99 });
});
test("rejects malformed, multi-range and unsatisfiable requests", () => {
    assert.equal(parseByteRange("items=0-10", 100), "invalid");
    assert.equal(parseByteRange("bytes=0-1,4-5", 100), "invalid");
    assert.equal(parseByteRange("bytes=100-", 100), "invalid");
    assert.equal(parseByteRange("bytes=-0", 100), "invalid");
    assert.equal(parseByteRange(undefined, 100), null);
});
