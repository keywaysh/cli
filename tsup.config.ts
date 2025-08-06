// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['cjs'],
  outDir: 'dist',
  clean: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
})