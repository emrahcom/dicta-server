import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteForLog } from "../src/logging.ts";

const cases: { name: string; value: string; expected: string }[] = [
  { name: "a plain id", value: "user-1", expected: '"user-1"' },
  {
    name: "non-ASCII letters",
    value: "anna.m\u00fcller@example.com",
    expected: '"anna.m\u00fcller@example.com"',
  },
  { name: "an emoji", value: "a\u{1f600}b", expected: '"a\u{1f600}b"' },
  { name: "a newline", value: "a\nb", expected: '"a\\nb"' },
  {
    name: "a quote and a backslash",
    value: 'a"b\\c',
    expected: '"a\\"b\\\\c"',
  },
  {
    name: "a terminal escape",
    value: "a\u001b[31mb",
    expected: '"a\\u001b[31mb"',
  },
  { name: "DEL", value: "a\u007fb", expected: '"a\\u007fb"' },
  { name: "a bidi override", value: "a\u202eb", expected: '"a\\u202eb"' },
  { name: "a zero-width space", value: "a\u200bb", expected: '"a\\u200bb"' },
  { name: "a line separator", value: "a\u2028b", expected: '"a\\u2028b"' },
  {
    name: "an invisible character outside the BMP",
    value: "a\u{e0001}b",
    expected: '"a\\udb40\\udc01b"',
  },
];

for (const { name, value, expected } of cases) {
  test(`quotes ${name}`, () => {
    assert.equal(quoteForLog(value), expected);
  });
}

test("keeps a value of 128 characters", () => {
  const value = "a".repeat(128);
  assert.equal(quoteForLog(value), `"${value}"`);
});

test("cuts a longer value to 128 characters", () => {
  assert.equal(quoteForLog("a".repeat(129)), `"${"a".repeat(128)}"...`);
});

test("does not split a character made of several code points", () => {
  const flag = "\u{1f1e9}\u{1f1ea}";
  assert.equal(quoteForLog(flag.repeat(129)), `"${flag.repeat(128)}"...`);
});

test("cuts by characters, not by UTF-16 units", () => {
  assert.equal(
    quoteForLog("\u{1f600}".repeat(129)),
    `"${"\u{1f600}".repeat(128)}"...`,
  );
});
