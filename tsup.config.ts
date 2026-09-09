import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cli/main.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: false,
    clean: true,
    target: 'node20',
    outExtension({ format }) {
      return { js: format === 'esm' ? '.js' : '.cjs', dts: '.d.ts' };
    },
  },
]);
