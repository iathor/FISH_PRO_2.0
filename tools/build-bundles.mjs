import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const WEBPACK_BIN = '/usr/bin/webpack';

const TARGETS = [
  {
    name: 'runtime',
    entry: 'js/app.js',
    outputs: ['app-runtime.js', 'js/app.bundle.js'],
  },
  {
    name: 'web-desktop',
    entry: 'js/entries/web-desktop.js',
    outputs: ['js/dist/web-desktop.bundle.js'],
  },
  {
    name: 'web-mobile',
    entry: 'js/entries/web-mobile.js',
    outputs: ['js/dist/web-mobile.bundle.js'],
  },
  {
    name: 'app-user',
    entry: 'js/entries/app-user.js',
    outputs: ['js/dist/app-user.bundle.js'],
  },
  {
    name: 'app-admin',
    entry: 'js/entries/app-admin.js',
    outputs: ['js/dist/app-admin.bundle.js'],
  },
];

function buildTarget(target) {
  const entryAbs = path.resolve(ROOT, target.entry);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(`Entry file not found: ${entryAbs}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `klev-wp-${target.name}-`));
  try {
    execFileSync(
      WEBPACK_BIN,
      (target.name === 'app-user' ? ['--config', path.resolve(ROOT, 'tools/webpack.target.cjs'), '--env', `entry=${entryAbs}`, '--env', `outDir=${tmpDir}`, '--env', 'outFile=main.js', '--env', 'noAdmin=1'] : ['--entry', entryAbs, '--mode', 'production', '--output-path', tmpDir]),
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }
    );

    const builtFile = path.join(tmpDir, 'main.js');
    if (!fs.existsSync(builtFile)) {
      throw new Error(`Webpack did not emit main.js for target "${target.name}"`);
    }

    const bundleContent = fs.readFileSync(builtFile);
    if (!bundleContent || bundleContent.length === 0) {
      throw new Error(`Empty bundle generated for target "${target.name}"`);
    }

    for (const relOut of target.outputs) {
      const destAbs = path.resolve(ROOT, relOut);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, bundleContent);
      console.log(`[build-bundles] ${target.name}: ${relOut} (${bundleContent.length} bytes)`);
    }
  } catch (err) {
    const details = err.stderr ? `\n${err.stderr}` : '';
    throw new Error(`Failed building target "${target.name}": ${err.message}${details}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(WEBPACK_BIN)) {
    throw new Error(`Webpack binary not found at ${WEBPACK_BIN}`);
  }
  for (const target of TARGETS) {
    buildTarget(target);
  }
  console.log('[build-bundles] All 5 bundles built successfully.');
}

main();
