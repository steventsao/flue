'use agent';
import { useModel } from '@flue/runtime';

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity (Hello -> the
// FlueHelloAgent Durable Object class; see wrangler.jsonc migrations).
export function Hello() {
	useModel('anthropic/claude-haiku-4-5');
	return 'You are a helpful assistant running on a self-hosted celld fleet. Keep replies short.';
}
