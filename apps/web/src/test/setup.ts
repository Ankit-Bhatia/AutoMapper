import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

expect.extend(matchers);

if (typeof window !== 'undefined') {
  const storage = window.localStorage as Storage & { clear?: () => void };
  if (typeof storage.clear !== 'function') {
    const backingStore = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => backingStore.get(key) ?? null,
        setItem: (key: string, value: string) => {
          backingStore.set(String(key), String(value));
        },
        removeItem: (key: string) => {
          backingStore.delete(key);
        },
        clear: () => {
          backingStore.clear();
        },
        key: (index: number) => Array.from(backingStore.keys())[index] ?? null,
        get length() {
          return backingStore.size;
        },
      } satisfies Storage,
    });
  }
}
