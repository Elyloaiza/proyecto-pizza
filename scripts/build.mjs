// Compilación estática: esbuild empaqueta React + TypeScript a dist/. (Ver README: por qué esbuild y no Vite.)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export async function buildApp({ minify = true, sourcemap = false } = {}) {
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist/assets', { recursive: true });
  await build({
    entryPoints: { main: 'src/main.tsx' },
    outdir: 'dist/assets',
    bundle: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    minify,
    sourcemap,
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
    logLevel: 'info',
  });
  writeFileSync('dist/index.html', readFileSync('index.html', 'utf8'));
  cpSync('public', 'dist', { recursive: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildApp();
  console.log('Build listo en dist/');
}
