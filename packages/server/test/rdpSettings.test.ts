import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateRdpSettings } from '../src/services/rdpSettings.js';

describe('validateRdpSettings', () => {
  it('accepts the known graphics modes and boolean metrics', () => {
    for (const mode of ['legacy', 'egfx', 'h264', 'h264-444']) assert.equal(validateRdpSettings({ 'rdp.graphics_mode': mode }), null);
    assert.equal(validateRdpSettings({ 'rdp.metrics_enabled': 'true' }), null);
    assert.equal(validateRdpSettings({ 'rdp.metrics_enabled': 'false' }), null);
  });

  it('ignores updates that do not touch RDP settings', () => {
    assert.equal(validateRdpSettings({ 'app.name': 'x' }), null);
  });

  it('rejects anything else', () => {
    assert.match(validateRdpSettings({ 'rdp.graphics_mode': 'H264' }) ?? '', /legacy, egfx, h264, h264-444/);
    assert.match(validateRdpSettings({ 'rdp.graphics_mode': '' }) ?? '', /rdp.graphics_mode/);
    assert.match(validateRdpSettings({ 'rdp.metrics_enabled': '1' }) ?? '', /rdp.metrics_enabled/);
    assert.match(validateRdpSettings({ 'rdp.metrics_enabled': true }) ?? '', /rdp.metrics_enabled/);
  });
});
