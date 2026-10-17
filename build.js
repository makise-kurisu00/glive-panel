const result = await Bun.build({
  entrypoints: ['./src/main.jsx'],
  outdir: './dist',
  target: 'browser',
  minify: true,
  naming: '[name].[ext]',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log('Browser assets built in dist/');
