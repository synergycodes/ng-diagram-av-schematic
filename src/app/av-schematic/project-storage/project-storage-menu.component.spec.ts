import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_ID } from './project-storage-menu.component';

describe('ProjectStorageMenuComponent defaults', () => {
  it('suggests Talus-Droid as the initial project id', () => {
    expect(DEFAULT_PROJECT_ID).toBe('talus-droid');
  });
});
