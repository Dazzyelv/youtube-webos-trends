import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitBesideGuide } from '../src/guide-fit/core.ts';

test('the page shrinks so its content starts past the guide and ends at the screen edge', () => {
  // Measured on the TV: 1920 wide, content inset 156 (the collapsed guide),
  // the open guide's background ends at 543.
  const { shift, scale } = fitBesideGuide(1920, 156, 543, 12);
  assert.ok(Math.abs(scale - 1365 / 1764) < 1e-9);
  assert.ok(
    Math.abs(shift + 156 * scale - 555) < 1e-9,
    'content starts at 555'
  );
  assert.ok(Math.abs(shift + 1920 * scale - 1920) < 1e-9, 'page ends at 1920');
});

test('a guide no wider than the inset needs no change', () => {
  assert.deepEqual(fitBesideGuide(1920, 156, 140, 12), { shift: 0, scale: 1 });
});

test('the page is never shrunk below half', () => {
  assert.equal(fitBesideGuide(1920, 156, 1800, 12).scale, 0.5);
});
