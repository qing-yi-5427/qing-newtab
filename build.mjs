/**
 * build.mjs
 *
 * esbuild build step. Bundles the modular `src/*` development sources into a
 * single minified IIFE (`newtab.js`) that the extension loads via
 * <script src="newtab.js">. This is purely concatenation + compression — no
 * runtime framework is introduced.
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await Promise.all([
  build({
    entryPoints: [path.join(__dirname, 'src', 'main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome100'],
    outfile: path.join(__dirname, 'newtab.js'),
    logLevel: 'info',
  }),
  build({
    entryPoints: [path.join(__dirname, 'src', 'web-chat-bridge.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome100'],
    outfile: path.join(__dirname, 'web-chat-bridge.js'),
    logLevel: 'info',
  }),
]);

console.log('Build complete → newtab.js, web-chat-bridge.js');
