'use strict';

const path = require('path');
const express = require('express');
const { analyzeUrl, PROFILES } = require('./lib/analyze');

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
