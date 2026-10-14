// Bundles the server (and the TypeScript-only @wos/shared package) into dist/.
// Third-party dependencies stay external and are installed in the Docker image with `pnpm deploy --prod`.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(resolve(here, p), 'utf8'));
const serverPkg = read('package.json');
const sharedPkg = read('../../packages/shared/package.json');
const external = [...new Set([...Object.keys(serverPkg.dependencies), ...Object.keys(sharedPkg.dependencies)])].filter((d) => d !== '@wos/shared');

rmSync(resolve(here, 'dist'), { recursive: true, force: true });
mkdirSync(resolve(here, 'dist'), { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/index.ts'), resolve(here, 'src/cli.ts')],
  outdir: resolve(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  external: [...external, ...external.map((d) => `${d}/*`)],
  alias: { '@wos/shared': resolve(here, '../../packages/shared/src/index.ts') },
  define: { 'process.env.BUILD_GIT_SHA': JSON.stringify(process.env.GIT_SHA ?? 'dev') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

cpSync(resolve(here, 'drizzle'), resolve(here, 'dist/drizzle'), { recursive: true });
console.log('server build complete');
