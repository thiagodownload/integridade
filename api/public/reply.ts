import { proxyPublicFunction } from '../_gateway'

export default async function handler(req: any, res: any) {
  return proxyPublicFunction(req, res, 'reply-report', 16_000)
}
