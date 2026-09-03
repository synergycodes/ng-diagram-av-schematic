import { type DeviceNodeData } from '../../../diagram/model/interfaces';

export type DeviceIllustrationId =
  | 'arduino-nano'
  | 'raspberry-pi-4'
  | 'mpu6050'
  | 'tb6612fng'
  | 'lm2596s'
  | 'hall-a3144'
  | null;

export const HALL_HEADER_PIN_X_POSITIONS = [51.5, 54.5, 57.5, 60.5] as const;

export function resolveDeviceIllustration(data: DeviceNodeData): DeviceIllustrationId {
  const manufacturer = data.manufacturer.trim().toLowerCase();
  const model = data.model.trim().toLowerCase();
  const identity = `${manufacturer} ${model}`;
  if (/\barduino\b/.test(manufacturer) && /^nano(?:\s+(?:classic|v?3(?:\.\d+)?))?$/.test(model)) {
    return 'arduino-nano';
  }
  if (
    /\braspberry pi\b/.test(manufacturer) &&
    /^(?:raspberry pi\s+)?4(?:\s+model\s+b)?$/.test(model)
  ) {
    return 'raspberry-pi-4';
  }
  if (/\bmpu6050\b/.test(identity) || /\bgy-521\b/.test(identity)) return 'mpu6050';
  if (/\btb6612fng\b/.test(identity)) return 'tb6612fng';
  if (/\blm2596s?\b/.test(identity)) return 'lm2596s';
  if (/\ba3144\b/.test(identity) && /\blm393\b/.test(identity)) return 'hall-a3144';
  return null;
}

export function deviceIllustrationLabel(id: Exclude<DeviceIllustrationId, null>): string {
  const labels: Record<Exclude<DeviceIllustrationId, null>, string> = {
    'arduino-nano': 'Ilustração original do Arduino Nano',
    'raspberry-pi-4': 'Ilustração original do Raspberry Pi 4',
    mpu6050: 'Ilustração original do MPU6050 GY-521',
    tb6612fng: 'Ilustração original do TB6612FNG',
    lm2596s: 'Ilustração original do LM2596S',
    'hall-a3144': 'Ilustração original do módulo Hall A3144 com LM393',
  };
  return labels[id];
}
