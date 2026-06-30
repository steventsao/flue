import { FlueProvider } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// The deployed LayoutParser API Worker (CORS-enabled). The Flue client talks to it.
const client = createFlueClient({
	baseUrl: 'https://flue-layoutparser.steventsao.workers.dev',
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
	<FlueProvider client={client}>
		<App />
	</FlueProvider>,
);
