import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function spa(path: string): boolean {
  return path === '/' || path === '/mine' || /^\/(?:c|s)\/[A-Za-z0-9_-]{1,120}$/.test(path);
}
function asset(path: string): boolean {
  if (path === '/favicon.ico' || path === '/robots.txt' || path === '/manifest.webmanifest') return true;
  return path.startsWith('/assets/') && path.slice(8).split('/').every(
    part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== '..'
  );
}

export async function createStaticHandler(root: string) {
  const base = await realpath(root);
  const index = await realpath(join(base, 'index.html'));
  if (index !== join(base, 'index.html')) throw new Error('dist/index.html must be a regular build file');
  const indexHandle = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await indexHandle.stat()).isFile()) throw new Error('dist/index.html must be a regular file');
  } finally { await indexHandle.close(); }

  return async (req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
    const isPage = spa(rawPath), isAsset = asset(rawPath);
    if (!isPage && !isAsset) { res.statusCode = 404; res.end(); return; }
    const target = isPage ? index : join(base, rawPath.slice(1));
    let resolved: string;
    try { resolved = await realpath(target); }
    catch (err) {
      if (err && typeof err === 'object' && 'code' in err && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(err.code))) {
        res.statusCode = 404; res.end(); return;
      }
      throw err;
    }
    if (resolved !== index && !resolved.startsWith(base + sep)) { res.statusCode = 404; res.end(); return; }
    const mime = types[extname(resolved).toLowerCase()];
    if (!mime) { res.statusCode = 404; res.end(); return; }
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) { res.statusCode = 404; res.end(); return; }
      const contents = await handle.readFile();
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', contents.length);
      res.setHeader('Cache-Control', isPage ? 'no-store' :
        /^\/assets\/demo-artwork-v[0-9]+\//.test(rawPath) || /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(rawPath)
          ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.statusCode = 200;
      res.end(req.method === 'HEAD' ? undefined : contents);
    } finally { await handle.close(); }
  };
}
