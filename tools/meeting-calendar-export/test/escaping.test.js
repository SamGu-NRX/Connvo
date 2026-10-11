import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, unescapeText, foldLine } from '../src/ics.js';

test('RFC 5545 3.3.11 TEXT escaping', () => {
  assert.equal(escapeText('plain'), 'plain');
  assert.equal(escapeText('a;b'), 'a\\;b');
  assert.equal(escapeText('a,b'), 'a\\,b');
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('a\nb'), 'a\\nb');
  assert.equal(escapeText('a\r\nb'), 'a\\nb');
  assert.equal(escapeText('a\rb'), 'a\\nb');
});

test('injection canaries cannot break out of a property value', () => {
  const hostile = 'x\nBEGIN:VEVENT\nSUMMARY:injected\nEND:VEVENT';
  const escaped = escapeText(hostile);
  assert.ok(!escaped.includes('\n'), 'no raw newlines may survive escaping');
  assert.equal(unescapeText(escaped), hostile, 'hostile text roundtrips as data, never as structure');
});

test('escape/unescape roundtrip', () => {
  for (const s of ['plain', 'a,b;c\\d\ne\r\nf', 'quote"colon:next']) {
    assert.equal(unescapeText(escapeText(s)), s);
  }
});

test('folding keeps every line within 75 octets and preserves content', () => {
  const folded = foldLine('SUMMARY:' + 'T'.repeat(300));
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.equal(folded.split('\r\n ').join(''), 'SUMMARY:' + 'T'.repeat(300));
});

test('folding never splits a UTF-8 sequence', () => {
  const folded = foldLine('SUMMARY:' + 'é'.repeat(60));
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.equal(folded.split('\r\n ').join(''), 'SUMMARY:' + 'é'.repeat(60));
});
