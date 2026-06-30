import { useFlueClient } from '@flue/react';
import { useState } from 'react';
import pageUrl from './page.png';

// bbox = [y_min, x_min, y_max, x_max], normalized 0–1000 on each axis.
interface Region {
	label: string;
	bbox: [number, number, number, number];
	order: number;
}

// Distinct color per DocLayNet label.
const LABEL_COLORS: Record<string, string> = {
	Title: '#e11d48',
	'Section-header': '#7c3aed',
	Text: '#2563eb',
	Table: '#059669',
	Picture: '#db2777',
	Caption: '#d97706',
	'Page-header': '#0891b2',
	'Page-footer': '#64748b',
	'List-item': '#ca8a04',
	Formula: '#9333ea',
	Footnote: '#475569',
};
const colorFor = (label: string) => LABEL_COLORS[label] ?? '#111827';

// Parse the agent's <div data-bbox="[...]" data-label="..."></div> output.
function parseRegions(html: string): Region[] {
	const re = /<div\s+data-bbox="\[([^\]]+)\]"\s+data-label="([^"]+)"/g;
	const out: Region[] = [];
	let m: RegExpExecArray | null;
	let order = 0;
	while ((m = re.exec(html)) !== null) {
		const nums = (m[1] ?? '').split(',').map((s) => Number.parseFloat(s.trim()));
		if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
			out.push({
				label: m[2] ?? '',
				bbox: nums as [number, number, number, number],
				order: order++,
			});
		}
	}
	return out;
}

async function fetchAsBase64(url: string): Promise<string> {
	const blob = await (await fetch(url)).blob();
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

type Status = 'idle' | 'running' | 'done' | 'error';

export function App() {
	const client = useFlueClient();
	const [status, setStatus] = useState<Status>('idle');
	const [regions, setRegions] = useState<Region[]>([]);
	const [error, setError] = useState<string>();
	const [ms, setMs] = useState<number>();

	async function detect() {
		setStatus('running');
		setError(undefined);
		setRegions([]);
		const started = performance.now();
		try {
			const image = await fetchAsBase64(pageUrl);
			const { result } = await client.workflows.invoke('detect-layout', {
				input: { image, mimeType: 'image/png' },
				wait: 'result',
			});
			const head = (result as { head?: string })?.head ?? '';
			setRegions(parseRegions(head));
			setMs(Math.round(performance.now() - started));
			setStatus('done');
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setStatus('error');
		}
	}

	return (
		<main>
			<header>
				<p className="eyebrow">Flue · @flue/react</p>
				<h1>LayoutParser bbox overlay</h1>
				<p className="sub">
					The Flue client runs the <code>detect-layout</code> workflow on the deployed Worker, then
					the returned <code>data-bbox</code> / <code>data-label</code> regions are drawn over the
					same page.
				</p>
			</header>

			<div className="toolbar">
				<button type="button" onClick={detect} disabled={status === 'running'}>
					{status === 'running' ? 'Detecting…' : 'Detect layout'}
				</button>
				<span className={`status ${status}`}>{status}</span>
				{status === 'done' && (
					<span className="meta">
						{regions.length} regions · {ms} ms
					</span>
				)}
			</div>

			{error && <p className="error">{error}</p>}

			<div className="stage">
				<div className="canvas">
					<img src={pageUrl} alt="document page" />
					{regions.map((r) => {
						const [yMin, xMin, yMax, xMax] = r.bbox;
						return (
							<div
								key={r.order}
								className="box"
								style={{
									left: `${xMin / 10}%`,
									top: `${yMin / 10}%`,
									width: `${(xMax - xMin) / 10}%`,
									height: `${(yMax - yMin) / 10}%`,
									borderColor: colorFor(r.label),
								}}
							>
								<span className="tag" style={{ background: colorFor(r.label) }}>
									{r.order + 1} {r.label}
								</span>
							</div>
						);
					})}
				</div>

				<aside className="legend">
					<h2>Regions</h2>
					{regions.length === 0 ? (
						<p className="empty">Run detection to see the layout map.</p>
					) : (
						<ol>
							{regions.map((r) => (
								<li key={r.order}>
									<span className="swatch" style={{ background: colorFor(r.label) }} />
									<span className="label">{r.label}</span>
									<span className="coords">[{r.bbox.join(', ')}]</span>
								</li>
							))}
						</ol>
					)}
				</aside>
			</div>
		</main>
	);
}
