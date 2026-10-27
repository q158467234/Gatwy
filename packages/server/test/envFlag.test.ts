import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { envFlag } from '../src/config.js';

describe('envFlag', () => {
  it('accepts 1/true/yes in any case and rejects everything else', () => {
    for (const on of ['1', 'true', 'TRUE', ' yes ']) assert.equal(envFlag(on), true, on);
    for (const off of [undefined, '', '0', 'false', 'no', 'on']) assert.equal(envFlag(off), false, String(off));
  });
});
