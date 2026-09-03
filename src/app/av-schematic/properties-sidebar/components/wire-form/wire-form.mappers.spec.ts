import { describe, expect, it } from 'vitest';
import { type WireEdgeData } from '../../../diagram/model/interfaces';
import {
  CUSTOM_COLOR_CHOICE,
  formDataToWireData,
  resolveFormColor,
  wireDataToFormData,
  type WireFormData,
} from './wire-form.mappers';

const baseForm = (): WireFormData => ({
  wireId: 'W1',
  wireType: 'control',
  netId: 'motor',
  colorChoice: '',
  customColor: '#888888',
  gauge: '22 AWG',
  length: '120 mm',
  note: 'Route near the board edge',
});

describe('wire form colors', () => {
  it('maps one palette choice to its WireViz token', () => {
    expect(resolveFormColor({ ...baseForm(), colorChoice: 'OG' })).toEqual({
      color: '#f2820d',
      colorCode: 'OG',
    });
  });

  it('keeps a custom hex render value and records its WireViz hex token', () => {
    expect(
      resolveFormColor({
        ...baseForm(),
        colorChoice: CUSTOM_COLOR_CHOICE,
        customColor: '#abc',
      }),
    ).toEqual({ color: '#abc', colorCode: '#AABBCC' });
  });

  it('keeps a canvas-only CSS color without inventing a WireViz token', () => {
    expect(
      resolveFormColor({
        ...baseForm(),
        colorChoice: CUSTOM_COLOR_CHOICE,
        customColor: 'rebeccapurple',
      }),
    ).toEqual({ color: 'rebeccapurple', colorCode: undefined });
  });

  it('preserves an imported unlisted WireViz token while another field changes', () => {
    const existing: WireEdgeData = {
      type: 'wire',
      wireId: 'W1',
      colorCode: 'WHBK',
    };
    const formData = wireDataToFormData(existing);

    expect(formData.colorChoice).toBe('WHBK');
    expect(formDataToWireData({ ...formData, note: 'Faixa preta' }, existing)).toMatchObject({
      color: undefined,
      colorCode: 'WHBK',
      notes: 'Faixa preta',
    });
  });

  it('keeps an explicit custom color custom even when it matches the palette RGB', () => {
    const resolved = resolveFormColor({
      ...baseForm(),
      colorChoice: CUSTOM_COLOR_CHOICE,
      customColor: '#e2231a',
    });

    expect(resolved).toEqual({ color: '#e2231a', colorCode: '#E2231A' });
    expect(wireDataToFormData({ type: 'wire', wireId: 'W1', color: '#E2231A' }).colorChoice).toBe(
      CUSTOM_COLOR_CHOICE,
    );
  });
});

describe('wire form data mapping', () => {
  it('edits a jumper color without losing its board owner', () => {
    const existing: WireEdgeData = {
      type: 'wire',
      wireId: 'J1',
      wireType: 'jumper',
      jumperBoardId: 'breadboard',
    };
    const form = wireDataToFormData(existing);

    expect(
      formDataToWireData(
        { ...form, colorChoice: CUSTOM_COLOR_CHOICE, customColor: '#123456' },
        existing,
      ),
    ).toMatchObject({
      jumperBoardId: 'breadboard',
      color: '#123456',
      colorCode: '#123456',
    });
  });

  it('round-trips all editable wire metadata through the single wire model', () => {
    const existing: WireEdgeData = { type: 'wire', wireId: 'old', netId: 'derived-net' };
    const data = formDataToWireData(baseForm(), existing);

    expect(data).toEqual({
      type: 'wire',
      wireId: 'W1',
      wireType: 'control',
      netId: 'derived-net',
      color: undefined,
      colorCode: undefined,
      gauge: '22 AWG',
      length: '120 mm',
      notes: 'Route near the board edge',
    });
    expect(wireDataToFormData(data)).toMatchObject({ ...baseForm(), netId: 'derived-net' });
  });

  it('updates only one physical wire when two wires share the same net', () => {
    const first: WireEdgeData = { type: 'wire', wireId: 'W1', netId: 'motor' };
    const second: WireEdgeData = {
      type: 'wire',
      wireId: 'W2',
      netId: 'motor',
      color: '#f7d417',
      colorCode: 'YE',
    };

    const updated = formDataToWireData(
      {
        ...baseForm(),
        colorChoice: CUSTOM_COLOR_CHOICE,
        customColor: '#123456',
      },
      first,
    );

    expect(updated).toMatchObject({ wireId: 'W1', netId: 'motor', color: '#123456' });
    expect(first).toEqual({ type: 'wire', wireId: 'W1', netId: 'motor' });
    expect(second).toEqual({
      type: 'wire',
      wireId: 'W2',
      netId: 'motor',
      color: '#f7d417',
      colorCode: 'YE',
    });
  });

  it('preserves an imported wire type that is not listed by the picker', () => {
    const existing: WireEdgeData = {
      type: 'wire',
      wireId: 'W1',
      wireType: 'coaxial-75-ohm',
    };
    const formData = wireDataToFormData(existing);

    expect(formData.wireType).toBe('coaxial-75-ohm');
    expect(formDataToWireData({ ...formData, note: 'Vídeo SDI' }, existing)).toMatchObject({
      wireType: 'coaxial-75-ohm',
      notes: 'Vídeo SDI',
    });
  });
});
