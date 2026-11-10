import { handleApiRoute, type ApiRequest } from './apiRouter.ts';

export async function handleVercelRequest(req: any, res: any) {
  let requestUrl: string =
    req.headers?.['x-forwarded-uri'] ||
    req.headers?.['x-matched-path'] ||
    req.url ||
    '/';

  if (requestUrl === '/api' || requestUrl === '/api/') {
    if (req.query?.path) {
      const p = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
      requestUrl = `/api/${p}`;
    } else {
      requestUrl = '/api/setup';
    }
  }

  const apiReq: ApiRequest = {
    method: req.method || 'GET',
    url: requestUrl,
    query: (req.query as Record<string, string>) || {},
    body: req.body,
    headers: (req.headers as Record<string, string | undefined>) || {},
  };

  const response = await handleApiRoute(apiReq);

  // Default no-store cache header to prevent Edge / CDN stale caching across multiple devices
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (response.headers) {
    for (const [k, v] of Object.entries(response.headers)) {
      res.setHeader(k, v);
    }
  }

  res.statusCode = response.statusCode;

  if (Buffer.isBuffer(response.body)) {
    res.end(response.body);
  } else if (typeof response.body === 'object') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response.body));
  } else {
    res.end(String(response.body ?? ''));
  }
}
