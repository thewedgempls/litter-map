const fs = require('fs/promises');
const path = require('path');

const SRC = __dirname;
const DIST = path.join(__dirname, 'dist');

(async () => {
  const { minify: minifyJS } = await import('terser');
  const CleanCSS = (await import('clean-css')).default;
  const { minify: minifyHTML } = await import('html-minifier-terser');

  await fs.mkdir(DIST, { recursive: true });

  const [jsSource, cssSource, htmlSource] = await Promise.all([
    fs.readFile(path.join(SRC, 'litter-tracker.js'), 'utf8'),
    fs.readFile(path.join(SRC, 'litter-tracker.css'), 'utf8'),
    fs.readFile(path.join(SRC, 'litter-tracker.html'), 'utf8'),
  ]);

  // JS — mangle locals but NOT top-level names (inline onclick handlers call them by name)
  const jsResult = await minifyJS(jsSource, {
    compress: true,
    mangle: { toplevel: false },
  });

  // CSS
  const cssResult = new CleanCSS({ level: 2 }).minify(cssSource);
  if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));

  // HTML — strip comments and whitespace; leave inline event-handler JS untouched
  const htmlResult = await minifyHTML(htmlSource, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false,
  });

  await Promise.all([
    fs.writeFile(path.join(DIST, 'litter-tracker.js'), jsResult.code),
    fs.writeFile(path.join(DIST, 'litter-tracker.css'), cssResult.styles),
    fs.writeFile(path.join(DIST, 'litter-tracker.html'), htmlResult),
  ]);

  const fmt = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`litter-tracker.js   ${fmt(Buffer.byteLength(jsSource))} → ${fmt(Buffer.byteLength(jsResult.code))}`);
  console.log(`litter-tracker.css  ${fmt(Buffer.byteLength(cssSource))} → ${fmt(Buffer.byteLength(cssResult.styles))}`);
  console.log(`litter-tracker.html ${fmt(Buffer.byteLength(htmlSource))} → ${fmt(Buffer.byteLength(htmlResult))}`);
  console.log('\nBuild complete → dist/');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
