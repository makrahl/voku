import { spawn } from 'node:child_process';

/**
 * Dev loop without extra dependencies: compile once, then run the build under
 * `node --watch` alongside `tsc --watch`. Node's own type stripping can't be
 * used here because it won't resolve the `.js` specifiers that NodeNext requires.
 */
const children = [];

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('npx', ['tsc', '-b']).on('exit', (code) => {
  if (code !== 0) {
    console.error('\n[voku] initial build failed — fix the errors above and rerun.');
    process.exit(code ?? 1);
  }
  run('npx', ['tsc', '-b', '--watch', '--preserveWatchOutput']);
  run('node', ['--watch', '--enable-source-maps', 'dist/index.js']);
});
