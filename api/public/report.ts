import { proxyPublicFunction } from '../_gateway'

export default async function handler(req: any, res: any) {
  return proxyPublicFunction(req, res, 'submit-report', 64_000)
}
