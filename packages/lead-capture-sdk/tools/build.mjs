/**
 * Build du SDK `forms.js`.
 *
 * Le bundle est un IIFE : il est charge par une balise <script> ordinaire sur
 * des sites tiers, dont beaucoup ne servent pas de modules ES. L'executeur
 * @nx/esbuild n'emet que de l'ESM ou du CJS, d'ou ce script dedie — qui porte
 * en outre deux exigences de la US que l'executeur ne couvre pas :
 *
 *   - FE-13 AC7 : budget de 8 Ko compresse, verifie a chaque build
 *   - FE-11 AC4 / FE-13 AC7 : empreinte SRI publiee, versions immuables
 */
import { build, context } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const workspaceRoot = join(root, '..', '..');
const outDir = join(workspaceRoot, 'dist', 'packages', 'lead-capture-sdk');
const outFile = join(outDir, 'forms.js');

/** Budget impose par FE-13 AC7, en octets, sur la taille gzip. */
const GZIP_BUDGET = 8 * 1024;

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const options = {
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: outFile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Navigateurs des deux dernieres annees (FE-13 AC7).
  target: ['chrome109', 'firefox115', 'safari16', 'edge109'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  define: { __SDK_VERSION__: JSON.stringify(version) },
  banner: { js: `/*! Sankore forms.js v${version} | pas de dépendance */` },
};

mkdirSync(outDir, { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[lead-capture-sdk] watch actif');
} else {
  await build(options);
  report();
}

function report() {
  const bytes = readFileSync(outFile);
  const gzip = gzipSync(bytes).length;
  const brotli = brotliCompressSync(bytes).length;
  const sri = 'sha384-' + createHash('sha384').update(bytes).digest('base64');

  // L'empreinte accompagne le bundle : le back la sert dans `SnippetResult.sriHash`
  // et une version publiee ne doit plus jamais changer de contenu.
  writeFileSync(
    join(outDir, 'forms.js.meta.json'),
    JSON.stringify({ version, bytes: bytes.length, gzip, brotli, sri }, null, 2) + '\n',
  );

  const kb = (n) => (n / 1024).toFixed(2) + ' Ko';
  console.log(`[lead-capture-sdk] v${version}`);
  console.log(`  brut    ${kb(bytes.length)}`);
  console.log(`  gzip    ${kb(gzip)} / budget ${kb(GZIP_BUDGET)}`);
  console.log(`  brotli  ${kb(brotli)}`);
  console.log(`  SRI     ${sri}`);

  if (gzip > GZIP_BUDGET) {
    console.error(
      `\n[lead-capture-sdk] ÉCHEC : budget dépassé de ${kb(gzip - GZIP_BUDGET)}. ` +
        `Le SDK est chargé sur des sites tiers : la taille est une exigence, pas une indication.`,
    );
    process.exit(1);
  }
}
