import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const qaPath = fileURLToPath(new URL('../tests/browser.html', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const qa = pathname === '/__qa' || pathname === '/__qa/';
    const path = qa ? qaPath : resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!qa && path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403, { 'X-Content-Type-Options': 'nosniff' });
      response.end('Forbidden');
      return;
    }
    if (!qa) {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('Not a file');
    }
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': qa ? 'text/html; charset=utf-8' : contentTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end('Not found');
  }
});

server.listen(Number(option('--port', '4173')), option('--host', '127.0.0.1'), () => {
  process.stdout.write('CanopyGuard built-dashboard test server ready\n');
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
