import { handleApiRoute, type ApiRequest } from './apiRouter.ts';

export async function handleVercelRequest(req: any, res: any) {
  let rawUrl: string =
    req.headers?.['x-forwarded-uri'] ||
    req.headers?.['x-matched-path'] ||
    req.url ||
    '/api/setup';

  const parsedUrl = new URL(rawUrl, 'http://localhost');
  const queryObj: Record<string, string> = {};

  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v === undefined || v === null) continue;
      queryObj[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
    }
  }
  parsedUrl.searchParams.forEach((v, k) => {
    queryObj[k] = v;
  });

  let pathname = parsedUrl.pathname || '/api/setup';
  const rewritePath = queryObj['__path'] || queryObj['path'];
  if ((pathname === '/api' || pathname === '/api/') && rewritePath) {
    const cleanSub = String(rewritePath).replace(/^\/+/, '');
    pathname = cleanSub ? `/api/${cleanSub}` : '/api/setup';
    delete queryObj['__path'];
    delete queryObj['path'];
    parsedUrl.searchParams.delete('__path');
    parsedUrl.searchParams.delete('path');
  } else if (pathname === '/api' || pathname === '/api/') {
    pathname = '/api/setup';
  }

  const finalSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(queryObj)) {
    finalSearch.set(k, v);
  }
  const searchStr = finalSearch.toString();
  const requestUrl = searchStr ? `${pathname}?${searchStr}` : pathname;

  let parsedBody = req.body;
  if (typeof parsedBody === 'string' && parsedBody.trim()) {
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      // Keep original string if not JSON
    }
  }

  const apiReq: ApiRequest = {
    method: req.method || 'GET',
    url: requestUrl,
    query: queryObj,
    body: parsedBody,
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
