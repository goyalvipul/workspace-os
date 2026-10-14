import { z } from 'zod';
import type { RouteDoc } from './routes/kit.js';

function schemaOf(s: z.ZodType | undefined): unknown {
  if (!s) return undefined;
  try {
    return z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' });
  } catch {
    return { type: 'object' };
  }
}

/** Generates the OpenAPI document from the route registry (so docs cannot drift from implemented routes). */
export function buildOpenApi(docs: RouteDoc[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const d of docs) {
    const path = d.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const params = [...d.url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const op: Record<string, unknown> = {
      summary: d.summary,
      tags: [d.tag],
      parameters: params,
      security: d.public ? [] : [{ cookieAuth: [] }],
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'VALIDATION_ERROR' },
        '401': { description: 'UNAUTHENTICATED' },
        '403': { description: 'FORBIDDEN / CSRF' },
        '404': { description: 'NOT_FOUND' },
        '409': { description: 'VERSION_CONFLICT' },
        '429': { description: 'RATE_LIMITED' },
      },
    };
    const body = schemaOf(d.body);
    if (body) op.requestBody = { required: true, content: { 'application/json': { schema: body } } };
    const query = schemaOf(d.query) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    if (query?.properties) {
      (op.parameters as unknown[]).push(...Object.entries(query.properties).map(([name, sch]) => ({ name, in: 'query', required: query.required?.includes(name) ?? false, schema: sch })));
    }
    (paths[path] ??= {})[d.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Workspace OS API', version: '1.0.0', description: 'Same-origin cookie auth. Unsafe methods need the X-CSRF-Token header (from GET /auth/session). Mutations accept an Idempotency-Key header.' },
    servers: [{ url: '/' }],
    components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'wos_session' } } },
    paths,
  };
}
