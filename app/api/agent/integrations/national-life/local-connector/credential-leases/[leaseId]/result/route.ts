import { proxyCredentialBrokerRequest } from '@/lib/national-life/credentials/broker-proxy'

export async function POST(request: Request) {
  return proxyCredentialBrokerRequest(request)
}
