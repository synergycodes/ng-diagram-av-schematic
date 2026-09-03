import { type DeviceNodeData, type DevicePort } from '../diagram/model/interfaces';

export interface LibraryDevice {
  libraryId: string;
  template: DeviceNodeData;
}

const port = (
  id: string,
  label: string,
  direction: DevicePort['direction'],
  connectorType: string,
): DevicePort => ({ id, label, direction, connectorType });

export const createBlankTemplate = (): DeviceNodeData => ({
  type: 'device',
  deviceId: '',
  manufacturer: '',
  model: '',
  category: '',
  location: '',
  ports: [],
});

/**
 * Catalogo funcional do Talus-Droid. Os labels preservam os designadores
 * eletricos usados no firmware, no header fisico ou na serigrafia do modulo.
 */
export const SEED_LIBRARY: LibraryDevice[] = [
  {
    libraryId: 'lib-arduino-nano',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'Arduino',
      model: 'Nano',
      category: 'microcontroller',
      location: '',
      ports: [
        port('vin', 'VIN', 'input', 'Power'),
        port('5v', '5V', 'input', 'Power'),
        port('gnd', 'GND', 'input', 'Power'),
        port('d2', 'D2 / HALL_L', 'input', 'GPIO'),
        port('d3', 'D3 / HALL_R', 'input', 'GPIO'),
        port('a4', 'A4 / SDA', 'output', 'I2C'),
        port('a5', 'A5 / SCL', 'output', 'I2C'),
        port('d0', 'D0 / RX', 'input', 'UART'),
        port('d4', 'D4 / STBY', 'output', 'GPIO'),
        port('d5', 'D5 / PWMA', 'output', 'PWM'),
        port('d6', 'D6 / PWMB', 'output', 'PWM'),
        port('d7', 'D7 / AIN1', 'output', 'GPIO'),
        port('d8', 'D8 / AIN2', 'output', 'GPIO'),
        port('d9', 'D9 / BIN1', 'output', 'GPIO'),
        port('d10', 'D10 / BIN2', 'output', 'GPIO'),
        port('d11', 'D11 / BUZZER', 'output', 'PWM'),
        port('d1', 'D1 / TX', 'output', 'UART'),
      ],
    },
  },
  {
    libraryId: 'lib-raspberry-pi-4',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'Raspberry Pi',
      model: '4 Model B',
      category: 'single-board-computer',
      location: '',
      ports: [
        port('p1-3v3', 'P1 / 3V3', 'input', 'Power'),
        port('p2-5v', 'P2 / 5V', 'input', 'Power'),
        port('p6-gnd', 'P6 / GND', 'input', 'Power'),
        port('p10-gpio15', 'P10 / GPIO15 RXD', 'input', 'UART'),
        port('usb-data', 'USB / Kinect data', 'input', 'USB'),
        port('p3-gpio2', 'P3 / GPIO2 SDA1', 'output', 'I2C'),
        port('p5-gpio3', 'P5 / GPIO3 SCL1', 'output', 'I2C'),
        port('p8-gpio14', 'P8 / GPIO14 TXD', 'output', 'UART'),
      ],
    },
  },
  {
    libraryId: 'lib-mpu6050-gy521',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'InvenSense / Generic',
      model: 'MPU6050 / GY-521',
      category: 'imu',
      location: '',
      ports: [
        port('vcc', 'VCC', 'input', 'Power'),
        port('gnd', 'GND', 'input', 'Power'),
        port('scl', 'SCL', 'input', 'I2C'),
        port('sda', 'SDA', 'input', 'I2C'),
        port('ad0', 'AD0', 'input', 'GPIO'),
        port('xcl', 'XCL', 'output', 'I2C'),
        port('xda', 'XDA', 'output', 'I2C'),
        port('int', 'INT', 'output', 'GPIO'),
      ],
    },
  },
  {
    libraryId: 'lib-tb6612fng',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'Toshiba / Generic',
      model: 'TB6612FNG',
      category: 'motor-driver',
      location: '',
      ports: [
        port('vm', 'VM', 'input', 'Power'),
        port('vcc', 'VCC', 'input', 'Power'),
        port('gnd', 'GND', 'input', 'Power'),
        port('stby', 'STBY', 'input', 'GPIO'),
        port('pwma', 'PWMA', 'input', 'PWM'),
        port('ain1', 'AIN1', 'input', 'GPIO'),
        port('ain2', 'AIN2', 'input', 'GPIO'),
        port('pwmb', 'PWMB', 'input', 'PWM'),
        port('bin1', 'BIN1', 'input', 'GPIO'),
        port('bin2', 'BIN2', 'input', 'GPIO'),
        port('ao1', 'AO1', 'output', 'Motor'),
        port('ao2', 'AO2', 'output', 'Motor'),
        port('bo1', 'BO1', 'output', 'Motor'),
        port('bo2', 'BO2', 'output', 'Motor'),
      ],
    },
  },
  {
    libraryId: 'lib-lm2596s',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'Texas Instruments / Generic',
      model: 'LM2596S adjustable buck',
      category: 'voltage-regulator',
      location: '',
      ports: [
        port('in-plus', 'IN+', 'input', 'Power'),
        port('in-minus', 'IN-', 'input', 'Power'),
        port('out-plus', 'OUT+', 'output', 'Power'),
        port('out-minus', 'OUT-', 'output', 'Power'),
      ],
    },
  },
  {
    libraryId: 'lib-hall-a3144-lm393',
    template: {
      type: 'device',
      deviceId: '',
      manufacturer: 'Generic',
      model: 'A3144 / LM393 (4 vias — provisório)',
      category: 'hall-sensor',
      location: '',
      notes: 'Variante provisória de quatro vias; confirmar a serigrafia antes da montagem.',
      ports: [
        port('vcc', 'VCC', 'input', 'Power'),
        port('gnd', 'GND', 'input', 'Power'),
        port('ao', 'AO', 'output', 'GPIO'),
        port('do', 'DO', 'output', 'GPIO'),
      ],
    },
  },
];
