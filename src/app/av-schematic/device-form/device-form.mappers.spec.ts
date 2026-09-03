import { describe, expect, it } from 'vitest';
import { type DeviceNodeData } from '../diagram/model/interfaces';
import { formDataToDeviceData, type DeviceFormData } from './device-form.mappers';

const editedForm: DeviceFormData = {
  deviceId: 'R1-renamed',
  manufacturer: 'edited',
  model: '2k2',
  category: 'passive',
  location: 'Board B',
  ports: [{ id: 'forged', label: 'Forged', direction: 'output', hole: { row: 9, col: 9 } }],
};

describe('formDataToDeviceData', () => {
  it('preserves footprint-owned physical ports while updating descriptive fields', () => {
    const physical: DeviceNodeData = {
      type: 'device',
      deviceId: 'R1',
      manufacturer: 'generic',
      model: '1k',
      boardId: 'board-a',
      footprintId: 'resistor-1k',
      placement: { boardId: 'board-a', anchor: { row: 1, col: 2 }, rotation: 0 },
      ports: [
        { id: 'a', label: 'A', direction: 'input', hole: { row: 1, col: 2 } },
        { id: 'b', label: 'B', direction: 'output', hole: { row: 1, col: 4 } },
      ],
    };

    const updated = formDataToDeviceData(editedForm, physical);

    expect(updated).toMatchObject({
      deviceId: 'R1-renamed',
      manufacturer: 'edited',
      model: '2k2',
      boardId: 'board-a',
      footprintId: 'resistor-1k',
      placement: physical.placement,
    });
    expect(updated.ports).toBe(physical.ports);
  });

  it('continues to accept edited ports for a generic unplaced device', () => {
    const generic: DeviceNodeData = {
      type: 'device',
      deviceId: 'SRC1',
      manufacturer: 'generic',
      model: 'source',
      ports: [{ id: 'out', label: 'OUT', direction: 'output' }],
    };

    expect(formDataToDeviceData(editedForm, generic).ports).toBe(editedForm.ports);
  });
});
