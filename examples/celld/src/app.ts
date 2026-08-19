/**
 * `app.ts` — the application's route map, and the only required file.
 *
 * The default export owns the entire request pipeline via
 * `.fetch(request, env, ctx)`. On the celld target each mounted agent route
 * resolves the generated binding and forwards to that agent's Durable Object
 * via the Agents SDK, exactly as on Cloudflare; everything else is just a
 * Hono app.
 */
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Hello } from './agents/hello';

const app = new Hono();

// Custom route — runs in the worker isolate, NOT inside an agent's cell.
app.get('/api/ping', (c) => c.json({ pong: true, at: new Date().toISOString() }));

// The agent's HTTP surface. Relative to the mount:
//   POST /:id            prompt (202 admission)
//   GET|HEAD /:id        conversation stream
//   POST /:id/abort      abort in-flight work
app.route('/agents/hello', createAgentRouter(Hello));

export default app;
