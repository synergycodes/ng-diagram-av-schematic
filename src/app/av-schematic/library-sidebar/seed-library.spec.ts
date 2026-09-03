import { describe, expect, it } from 'vitest';
import { deviceCategoryLabel } from '../diagram/model/device-categories';
import { CONNECTOR_TYPES } from '../shared/ui/ports-editor/connector-types';
import { resolveDeviceIllustration } from '../shared/ui/device-illustration/device-illustration';
import { asDevicePaletteItem } from './components/library-list-item/palette-item-cast';
import { SEED_LIBRARY } from './seed-library';

const seed = (libraryId: string) => {
  const device = SEED_LIBRARY.find((candidate) => candidate.libraryId === libraryId);
  if (!device) throw new Error(`Missing seed ${libraryId}`);
  return device;
};

const portLabels = (libraryId: string) => seed(libraryId).template.ports.map((port) => port.label);

describe('Talus-Droid library catalog', () => {
  it('replaces the AV catalog with the six requested illustrated components', () => {
    expect(SEED_LIBRARY.map((device) => device.libraryId)).toEqual([
      'lib-arduino-nano',
      'lib-raspberry-pi-4',
      'lib-mpu6050-gy521',
      'lib-tb6612fng',
      'lib-lm2596s',
      'lib-hall-a3144-lm393',
    ]);
    expect(SEED_LIBRARY.every((device) => resolveDeviceIllustration(device.template))).toBe(true);
  });

  it('keeps the firmware-facing Nano and TB6612FNG pin labels and roles', () => {
    expect(portLabels('lib-arduino-nano')).toEqual(
      expect.arrayContaining([
        'D2 / HALL_L',
        'D3 / HALL_R',
        'D4 / STBY',
        'D5 / PWMA',
        'D6 / PWMB',
        'D7 / AIN1',
        'D8 / AIN2',
        'D9 / BIN1',
        'D10 / BIN2',
        'D11 / BUZZER',
        'A4 / SDA',
        'A5 / SCL',
      ]),
    );
    expect(portLabels('lib-tb6612fng')).toEqual(
      expect.arrayContaining([
        'VM',
        'VCC',
        'GND',
        'STBY',
        'PWMA',
        'PWMB',
        'AIN1',
        'AIN2',
        'BIN1',
        'BIN2',
        'AO1',
        'AO2',
        'BO1',
        'BO2',
      ]),
    );
    expect(
      seed('lib-tb6612fng')
        .template.ports.filter((port) => ['AO1', 'AO2', 'BO1', 'BO2'].includes(port.label))
        .every((port) => port.connectorType === 'Motor'),
    ).toBe(true);
  });

  it('models the exact module variants without conflating similar hardware', () => {
    const hall = seed('lib-hall-a3144-lm393').template;
    const converter = seed('lib-lm2596s').template;

    expect(hall.ports.map((port) => port.label)).toEqual(['VCC', 'GND', 'AO', 'DO']);
    expect(hall.model).toContain('provisório');
    expect(hall.notes).toContain('confirmar a serigrafia');
    expect(converter.model).toContain('LM2596S');
    expect(converter.model).not.toContain('XL4015');
    expect(converter.ports.map((port) => port.label)).toEqual(['IN+', 'IN-', 'OUT+', 'OUT-']);
  });

  it('offers every requested connector type to manual components', () => {
    expect(CONNECTOR_TYPES).toEqual(
      expect.arrayContaining(['Power', 'GPIO', 'I2C', 'PWM', 'UART', 'Motor']),
    );
    expect(CONNECTOR_TYPES.indexOf('TRS')).toBeLessThan(CONNECTOR_TYPES.indexOf('UART'));
    expect(CONNECTOR_TYPES.indexOf('UART')).toBeLessThan(CONNECTOR_TYPES.indexOf('USB'));
  });

  it('models Nano controller signals toward the MPU while keeping power pins as inputs', () => {
    const nanoPorts = seed('lib-arduino-nano').template.ports;
    const mpuPorts = seed('lib-mpu6050-gy521').template.ports;

    expect(nanoPorts.find((port) => port.id === 'a4')?.direction).toBe('output');
    expect(nanoPorts.find((port) => port.id === 'a5')?.direction).toBe('output');
    expect(nanoPorts.find((port) => port.id === '5v')?.direction).toBe('input');
    expect(nanoPorts.find((port) => port.id === 'gnd')?.direction).toBe('input');
    expect(mpuPorts.find((port) => port.id === 'sda')?.direction).toBe('input');
    expect(mpuPorts.find((port) => port.id === 'scl')?.direction).toBe('input');
  });

  it('localizes the Talus-Droid category labels explicitly', () => {
    expect(deviceCategoryLabel('microcontroller')).toBe('Microcontroladores');
    expect(deviceCategoryLabel('single-board-computer')).toBe('Computadores de placa única');
    expect(deviceCategoryLabel('imu')).toBe('Unidades de medição inercial');
    expect(deviceCategoryLabel('motor-driver')).toBe('Drivers de motor');
    expect(deviceCategoryLabel('voltage-regulator')).toBe('Reguladores de tensão');
    expect(deviceCategoryLabel('hall-sensor')).toBe('Sensores Hall');
  });

  it('clones a catalog template into a draggable palette item', () => {
    const template = seed('lib-mpu6050-gy521').template;
    const paletteItem = asDevicePaletteItem(template) as unknown as { data: typeof template };

    expect(paletteItem.data).toEqual(template);
    expect(paletteItem.data).not.toBe(template);
  });
});
