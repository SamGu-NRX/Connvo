import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIcsUtc, parseIcsUtc } from '../src/ics.js';

test('exact UTC conversion from epoch milliseconds', () => {
  assert.equal(toIcsUtc(Date.UTC(2026, 9, 11, 7, 0, 0)), '20261011T070000Z');
  assert.equal(toIcsUtc(0), '19700101T000000Z');
  assert.equal(toIcsUtc(Date.UTC(1999, 11, 31, 23, 59, 59)), '19991231T235959Z');
});

test('sub-second precision is truncated (floored), never rounded', () => {
  assert.equal(toIcsUtc(Date.UTC(2026, 0, 1, 0, 0, 0) + 499), '20260101T000000Z');
  assert.equal(toIcsUtc(Date.UTC(2026, 0, 1, 0, 0, 0) + 999), '20260101T000000Z');
  assert.equal(toIcsUtc(Date.UTC(2026, 0, 1, 0, 0, 0) + 1500), '20260101T000001Z');
});

test('UTC rendering is DST-immune: fixed instants render identically year-round', () => {
  assert.equal(toIcsUtc(Date.UTC(2026, 6, 15, 12, 0, 0)), '20260715T120000Z');
  assert.equal(toIcsUtc(Date.UTC(2026, 0, 15, 12, 0, 0)), '20260115T120000Z');
});

test('roundtrip through parseIcsUtc preserves whole seconds', () => {
  const t = Date.UTC(2026, 4, 5, 6, 7, 8);
  assert.equal(parseIcsUtc(toIcsUtc(t)), t);
});

test('rejects invalid input', () => {
  assert.throws(() => toIcsUtc(-1));
  assert.throws(() => toIcsUtc(NaN));
});
