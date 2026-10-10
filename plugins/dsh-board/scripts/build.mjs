import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const plugin = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const run = async args => {
  const result = await promisify(execFile)(process.execPath, args, { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
};
if (!process.argv.includes('--client-only')) {
  await run(['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']);
  await run(['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.model.config.ts']);
  await run(['node_modules/vite/bin/vite.js', 'build', '--base', '/api/dsh-board/ui/', '--outDir', 'plugins/dsh-board/lib/board-ui', '--emptyOutDir']);
  await copyFile(repo + 'dist-model/index.js', plugin + 'lib/model.js');
  await copyFile(repo + 'LICENSE', plugin + 'lib/LICENSE');
}
const bundled = await build({ entryPoints: [plugin + 'src/client.jsx'], bundle: true, write: false,
  platform: 'browser', format: 'cjs', jsx: 'automatic', target: 'es2022',
  external: ['react', 'react/jsx-runtime', 'react-dom'], loader: { '.css': 'text' } });
await mkdir(plugin + 'lib', { recursive: true });
await writeFile(plugin + 'lib/client.js', `window.__ModuleLoader__.load({id:"dsh-board",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${bundled.outputFiles[0].text}\nreturn module.exports;}});\n`);
console.log('DSH-board client and embedded Draft Board built.');
