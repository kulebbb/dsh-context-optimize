import { defineConfig } from 'tsdown'

// 双入口：宿主半打 ESM，客户端半打浏览器 CJS 并按 DSH 客户端模块加载器的约定包一层。
// 约定与 dsh-output / dsh-git-tree 一致：`window.__ModuleLoader__.load({ id, factory })`。
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    fixedExtension: false,
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    external: ['yaml'],
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@kulebbb/dsh-context-optimize", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
