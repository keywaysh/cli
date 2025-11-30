// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  shims: true,
  target: 'node18',
})
