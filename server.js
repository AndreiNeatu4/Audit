'use strict';

const path = require('path');
const express = require('express');
const { analyzeUrl, PROFILES } = require('./lib/analyze');
const { crawlSite } = require('./lib/crawl');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// List of available screen/DPI profiles (so the UI can offer them).
app.get('/api/profiles', (_req, res) => {
  res.json(PROFILES.map((p) => ({ id: p.id, label: p.label })));
});

// Run an accessibility scan of a URL.
app.post('/api/scan', async (req, res) => {
  const { url, profiles } = req.body || {};
  if (!url) return res.status(400).json({ error: 'A URL is required.' });
  try {
    const result = await analyzeUrl(url, { profiles });
    res.json(result);
  } catch (err) {
    console.error('Scan failed:', err);
    res.status(500).json({ error: err.message || 'Scan failed.' });
  }
});

// Crawl a whole site (same-origin, breadth-first) and stream per-page scan
// results as Server-Sent Events, since a multi-page crawl can take minutes.
app.get('/api/crawl', async (req, res) => {
  const { url, maxPages, maxDepth, profiles } = req.query;
  if (!url) return res.status(400).json({ error: 'A URL is required.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(':\n\n'), 15000);

  let aborted = false;
  req.on('close', () => {
    aborted = true;
    clearInterval(heartbeat);
  });

  try {
    await crawlSite(
      url,
      {
        maxPages: Math.max(1, Math.min(200, parseInt(maxPages, 10) || 20)),
        maxDepth: Math.max(0, Math.min(5, parseInt(maxDepth, 10) || 2)),
        profiles: profiles ? String(profiles).split(',').filter(Boolean) : undefined,
        isAborted: () => aborted,
      },
      send
    );
  } catch (err) {
    console.error('Crawl failed:', err);
    if (!aborted) send('error', { message: err.message || 'Crawl failed.' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Start on the requested port; if it's already in use, try the next few ports
// automatically instead of crashing.
function start(port, attemptsLeft) {
  const server = app.listen(port, () => {
    console.log(`\n  EU Accessibility Checker running at  http://localhost:${port}\n`);
    console.log('  (Press Ctrl+C to stop.)\n');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  Port ${port} is busy — trying ${port + 1}…`);
      start(port + 1, attemptsLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`\n  Could not find a free port near ${port}.`);
      console.error(`  Free one up, or run:  $env:PORT=8080; npm start\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
start(PORT, 15);
