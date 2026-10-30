import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rdpDesktopSize, rdpResolution } from '../src/lib/rdpDisplay.js';

describe('rdpResolution', () => {
  it('defaults to sharp', () => {
    assert.equal(rdpResolution('saver'), 'saver');
    assert.equal(rdpResolution('sharp'), 'sharp');
    assert.equal(rdpResolution(undefined), 'sharp');
    assert.equal(rdpResolution('Saver'), 'sharp');
  });
});

describe('rdpDesktopSize', () => {
  it('requests device pixels and the matching scale when sharp', () => {
    assert.deepEqual(rdpDesktopSize(1280, 720, 1.5, 'sharp'), { width: 1920, height: 1080, scaleFactor: 150 });
    assert.deepEqual(rdpDesktopSize(1440, 900, 2, 'sharp'), { width: 2880, height: 1800, scaleFactor: 200 });
  });

  it('keeps CSS pixels and the server scale when saving data', () => {
    assert.deepEqual(rdpDesktopSize(1280, 720, 1.5, 'saver'), { width: 1280, height: 720, scaleFactor: undefined });
  });

  it('is the CSS size at 100% on a standard screen', () => {
    assert.deepEqual(rdpDesktopSize(1280, 720, 1, 'sharp'), { width: 1280, height: 720, scaleFactor: 100 });
  });

  it('never goes below one device pixel per CSS pixel (browser zoomed out)', () => {
    assert.deepEqual(rdpDesktopSize(1280, 720, 0.8, 'sharp'), { width: 1280, height: 720, scaleFactor: 100 });
  });

  it('rounds the scale to the 25% steps Windows offers', () => {
    assert.equal(rdpDesktopSize(1000, 600, 1.1, 'sharp').scaleFactor, 100);
    assert.equal(rdpDesktopSize(1000, 600, 1.25, 'sharp').scaleFactor, 125);
    assert.equal(rdpDesktopSize(1000, 600, 1.75, 'sharp').scaleFactor, 175);
  });

  it('keeps the width even', () => {
    assert.equal(rdpDesktopSize(1001, 600, 1, 'sharp').width, 1000);
    assert.equal(rdpDesktopSize(667, 600, 1.5, 'sharp').width, 1000);
    assert.equal(rdpDesktopSize(1001, 600, 1, 'saver').width, 1000);
  });

  it('clamps transiently small containers to the Display Control minimum', () => {
    assert.deepEqual(rdpDesktopSize(500, 50, 1, 'sharp'), { width: 500, height: 200, scaleFactor: 100 });
    assert.deepEqual(rdpDesktopSize(100, 100, 1.5, 'sharp'), { width: 200, height: 200, scaleFactor: 150 });
  });

  it('scales an oversized desktop down to the protocol limit, keeping its shape', () => {
    const { width, height, scaleFactor } = rdpDesktopSize(5120, 1440, 2, 'sharp');
    assert.equal(width, 8192);
    assert.equal(height, 2304);
    assert.equal(scaleFactor, 150); // 1.6x, rounded to the nearest 25% step
  });

  it('survives a non-finite ratio', () => {
    assert.deepEqual(rdpDesktopSize(800, 600, Number.NaN, 'sharp'), { width: 800, height: 600, scaleFactor: 100 });
  });
});
