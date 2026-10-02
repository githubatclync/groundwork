// Vitest config: unit tests for plain TypeScript logic (no Cesium / DOM needed).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
