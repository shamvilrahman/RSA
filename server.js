const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=UTF-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  let rawUrl = req.url.split('?')[0];
  let reqPath = decodeURI(rawUrl);

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Handle potential old absolute paths
  const vilmanMatch = reqPath.match(/VilMan\/RSA\/(?:v\s*4\.0[^\/]*\/)?(.*)$/i);
  if (vilmanMatch) {
    reqPath = '/' + vilmanMatch[1];
  }

  const cleanReqPath = reqPath.replace(/^\/+/, '');

  const searchCandidates = [
    path.join(__dirname, 'codes', cleanReqPath),
    path.join(__dirname, cleanReqPath),
    path.join(__dirname, 'images', path.basename(reqPath)),
    path.join(__dirname, 'videos', path.basename(reqPath)),
    path.join(__dirname, 'codes', path.basename(reqPath))
  ];

  let resolvedFile = null;
  for (const candidate of searchCandidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedFile = candidate;
        break;
      }
    } catch (e) {}
  }

  if (!resolvedFile) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(`<h3>404 Not Found</h3><p>Requested: ${req.url}</p>`);
    return;
  }

  const ext = path.extname(resolvedFile).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(resolvedFile);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Support HTTP 206 Partial Content for video/audio seek & play in Chrome/Safari/Edge
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`
      });
      return res.end();
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(resolvedFile, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(resolvedFile).pipe(res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://127.0.0.1:${PORT}`);
});
