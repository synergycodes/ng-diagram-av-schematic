export const DEVICE_CATEGORY_PREFIXES: Readonly<Record<string, string>> = {
  microphone: 'MIC',
  'wireless-mic': 'WMIC',
  'media-player': 'MEDIA',
  mixer: 'MIXER',
  amplifier: 'AMP',
  loudspeaker: 'SPK',
  display: 'DISPLAY',
  camera: 'CAM',
  switcher: 'SW',
  microcontroller: 'MCU',
  'single-board-computer': 'SBC',
  imu: 'IMU',
  'motor-driver': 'DRV',
  'voltage-regulator': 'REG',
  'hall-sensor': 'HALL',
};

export const DEVICE_CATEGORIES: readonly string[] = Object.keys(DEVICE_CATEGORY_PREFIXES);

export const DEVICE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  microphone: 'Microfones',
  'wireless-mic': 'Microfones sem fio',
  'media-player': 'Reprodutores de mídia',
  mixer: 'Mesas de som',
  amplifier: 'Amplificadores',
  loudspeaker: 'Alto-falantes',
  display: 'Telas',
  camera: 'Câmeras',
  switcher: 'Comutadores',
  microcontroller: 'Microcontroladores',
  'single-board-computer': 'Computadores de placa única',
  imu: 'Unidades de medição inercial',
  'motor-driver': 'Drivers de motor',
  'voltage-regulator': 'Reguladores de tensão',
  'hall-sensor': 'Sensores Hall',
};

export const deviceCategoryLabel = (category: string): string =>
  DEVICE_CATEGORY_LABELS[category] ??
  category.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

export const FALLBACK_DEVICE_PREFIX = 'DEV';
