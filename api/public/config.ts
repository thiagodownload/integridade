import { proxyPublicFunction } from '../_gateway'

export default async function handler(req: any, res: any) {
  return proxyPublicFunction(req, res, 'public-config', 4_000, ['GET', 'POST'])
}
