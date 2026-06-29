import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';

// ParseBench ran on OpenRouter — register it as an OpenAI-compatible provider so
// the model spec `openrouter/google/gemini-3.1-flash-lite-preview` resolves.
registerProvider('openrouter', {
	api: 'openai-completions',
	baseUrl: 'https://openrouter.ai/api/v1',
	apiKey: process.env.OPENROUTER_API_KEY,
});

const app = new Hono();
app.route('/', flue());

export default app;
