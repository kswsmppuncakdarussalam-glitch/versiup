import express from 'express';
import { createServer as createViteServer } from 'vite';
import { handleVercelRequest } from './server/vercelHandler.ts';

const app = express();
const PORT = 3000;

// Middleware for parsing json and urlencoded data
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Forward all /api/* requests to the API router
app.all('/api/*', async (req, res) => {
  try {
    await handleVercelRequest(req, res);
  } catch (err: any) {
    console.error('[API Handler Exception]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Internal Server Error' });
    }
  }
});

async function init() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  } else {
    // Mount Vite dev server middleware (standard AI Studio Full-Stack pattern)
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Disiplin Kita Bisa dev server running at http://0.0.0.0:${PORT}`);
  });
}

init().catch((err) => {
  console.error('[Server Init Failed]:', err);
  process.exit(1);
});
