import { handleVercelRequest } from '../server/vercelHandler.ts';

export default async function handler(req: any, res: any) {
  return handleVercelRequest(req, res);
}
