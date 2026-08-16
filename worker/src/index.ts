export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

const ALLOWED_ORIGINS = ['https://alleyadmin.app'];

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const allowedOrigin = env.ALLOWED_ORIGIN ?? 'https://alleyadmin.app';
  const origins = [...ALLOWED_ORIGINS, allowedOrigin];
  const requestOrigin = request.headers.get('Origin') ?? '';
  const origin = origins.includes(requestOrigin)
    ? requestOrigin
    : 'https://alleyadmin.app';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let email: string;
    try {
      const body = (await request.json()) as { email?: string };
      email = (body.email ?? '').trim().toLowerCase();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO registrations (email) VALUES (?)',
      )
        .bind(email)
        .run();
    } catch {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
