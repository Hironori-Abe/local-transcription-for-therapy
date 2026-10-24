'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSupportedPatchedNode } = require('./check-node-security.cjs');

test('reject vulnerable, end-of-life, and unreviewed Node releases', () => {
  for (const version of ['20.20.0', '22.23.2', '22.23.3', '24.22.0',
    '26.12.0', '23.99.0', '27.0.0', '24.22.1-rc.1', 'invalid']) {
    assert.equal(isSupportedPatchedNode(version), false, version);
  }
});

test('accept fixed releases and later patches in supported branches', () => {
  for (const version of ['22.23.4', '22.24.0', '24.22.1', '24.23.0',
    '26.12.1', '26.13.0']) {
    assert.equal(isSupportedPatchedNode(version), true, version);
  }
});
