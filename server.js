const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Increase limit for profile uploads and synchronization
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.text({ type: '*/*', limit: '50mb' }));

// Middleware to reconstruct query parameters that might have raw parts
app.use((req, res, next) => {
  if (req.url.includes('?path=')) {
    const rawPath = req.url.slice(req.url.indexOf('?path=') + 6);
    req.query.path = decodeURIComponent(rawPath);
  } else if (req.url.includes('&path=')) {
    const rawPath = req.url.slice(req.url.indexOf('&path=') + 6);
    req.query.path = decodeURIComponent(rawPath);
  }
  
  if (req.url.includes('?url=')) {
    const rawUrl = req.url.slice(req.url.indexOf('?url=') + 5);
    req.query.url = decodeURIComponent(rawUrl);
  } else if (req.url.includes('&url=')) {
    const rawUrl = req.url.slice(req.url.indexOf('&url=') + 5);
    req.query.url = decodeURIComponent(rawUrl);
  }
  next();
});

// Wrapper to bridge Express req/res to Vercel-style handlers
function makeHandler(apiFile, forceQuery = {}) {
  return async (req, res) => {
    try {
      // Inject forceQuery parameters (e.g. reply=true for comments/reply)
      for (let k in forceQuery) {
        req.query[k] = forceQuery[k];
      }
      
      const filePath = path.resolve(__dirname, apiFile);
      const mod = await import('file://' + filePath);
      let handler = mod.default || mod;
      if (handler && handler.default) {
        handler = handler.default;
      }
      
      if (typeof handler === 'function') {
        await handler(req, res);
      } else {
        res.status(500).json({ error: `API module ${apiFile} does not export a function handler` });
      }
    } catch (err) {
      console.error(`Error in API Route ${apiFile}:`, err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  };
}

// Rock-solid explicit mapping of all API endpoints
app.all('/api/anilist', makeHandler('./api/anilist.js'));
app.all('/api/comick', makeHandler('./api/comick.js'));

app.all('/api/comments/reply', makeHandler('./api/comments.js', { reply: 'true' }));
app.all('/api/comments/like', makeHandler('./api/comments.js', { like: 'true' }));
app.all('/api/comments', makeHandler('./api/comments.js'));

app.all('/api/img', makeHandler('./api/img.js'));
app.all('/api/pill', makeHandler('./api/pill.js'));

app.all('/api/profile/list', makeHandler('./api/profile.js', { list: 'true' }));
app.all('/api/profile', makeHandler('./api/profile.js'));

app.all('/api/proxy', makeHandler('./api/proxy.js'));
app.all('/api/sync', makeHandler('./api/sync.js'));
app.all('/api/weeb', makeHandler('./api/weeb.js'));

// Serve frontend static assets
app.use(express.static(__dirname));

// Fallback index.html for single-page routing or other requests
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Manganana listening on port ${PORT}`);
});

