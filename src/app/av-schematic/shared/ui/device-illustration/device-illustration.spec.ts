import { describe, expect, it } from 'vitest';
import { type DeviceNodeData } from '../../../diagram/model/interfaces';
import { HALL_HEADER_PIN_X_POSITIONS, resolveDeviceIllustration } from './device-illustration';

const device = (manufacturer: string, model: string): DeviceNodeData => ({
  type: 'device',
  deviceId: '',
  manufacturer,
  model,
  ports: [],
});

describe('resolveDeviceIllustration', () => {
  it('resolves the exact illustrated catalog families', () => {
    expect(resolveDeviceIllustration(device('Arduino', 'Nano'))).toBe('arduino-nano');
    expect(resolveDeviceIllustration(device('Raspberry Pi', '4 Model B'))).toBe('raspberry-pi-4');
    expect(resolveDeviceIllustration(device('InvenSense', 'MPU6050 / GY-521'))).toBe('mpu6050');
    expect(resolveDeviceIllustration(device('Toshiba', 'TB6612FNG'))).toBe('tb6612fng');
    expect(resolveDeviceIllustration(device('Texas Instruments', 'LM2596S'))).toBe('lm2596s');
    expect(resolveDeviceIllustration(device('Generic', 'LM2596'))).toBe('lm2596s');
    expect(resolveDeviceIllustration(device('Generic', 'A3144 / LM393'))).toBe('hall-a3144');
  });

  it('rejects neighboring models that only share broad substrings', () => {
    expect(resolveDeviceIllustration(device('Raspberry Pi', 'Zero 2 W rev 1.4'))).toBeNull();
    expect(resolveDeviceIllustration(device('Raspberry Pi', '400'))).toBeNull();
    expect(resolveDeviceIllustration(device('Arduino', 'Nano ESP32'))).toBeNull();
    expect(resolveDeviceIllustration(device('Texas Instruments', 'LM393 comparator'))).toBeNull();
  });

  it('defines four visible header pins for the provisional Hall module', () => {
    expect(HALL_HEADER_PIN_X_POSITIONS).toHaveLength(4);
  });
});
