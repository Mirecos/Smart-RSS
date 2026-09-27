import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  delayMs?: number;
  handler?: (req: IncomingMessage, res: ServerResponse) => void;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface FixtureServer {
  url: string;
  requests: RecordedRequest[];
  setRoute(path: string, route: FixtureRoute): void;
  close(): Promise<void>;
}

/** A tiny HTTP server that serves canned responses, used to simulate remote sources in tests. */
export async function startFixtureServer(initial: Record<string, FixtureRoute> = {}, port = 0): Promise<FixtureServer> {
  const routes = new Map(Object.entries(initial));
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '/';
      requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body: Buffer.concat(chunks).toString() });
      const route = routes.get(path);
      if (!route) {
        res.writeHead(404).end('not found');
        return;
      }
      const respond = () => {
        if (route.handler) return route.handler(req, res);
        res.writeHead(route.status ?? 200, route.headers ?? {}).end(route.body ?? '');
      };
      if (route.delayMs) setTimeout(respond, route.delayMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    setRoute: (path, route) => routes.set(path, route),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
