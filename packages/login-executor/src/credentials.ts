import { existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 60_000;

/** Resolve the Pi coding-agent auth file when present, then local auth.json. */
export function defaultPiAuthFile(): string {
	const configured = process.env.FLUE_PI_AUTH_FILE;
	if (configured) return path.resolve(expandHome(configured));
	const codingAgent = path.join(homedir(), '.pi', 'agent', 'auth.json');
	return existsSync(codingAgent) ? codingAgent : path.resolve('auth.json');
}

/** File-backed Pi credential store compatible with Pi's auth.json format. */
export class JsonCredentialStore implements CredentialStore {
	readonly file: string;

	constructor(file = defaultPiAuthFile()) {
		this.file = path.resolve(expandHome(file));
	}

	async read(providerId: string): Promise<Credential | undefined> {
		return (await this.readAll())[providerId];
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.withLock(async () => {
			const credentials = await this.readAll();
			const next = await fn(credentials[providerId]);
			if (next === undefined) return credentials[providerId];
			credentials[providerId] = next;
			await this.writeAll(credentials);
			return next;
		});
	}

	async delete(providerId: string): Promise<void> {
		await this.withLock(async () => {
			const credentials = await this.readAll();
			if (!(providerId in credentials)) return;
			delete credentials[providerId];
			await this.writeAll(credentials);
		});
	}

	private async readAll(): Promise<Record<string, Credential>> {
		let source: string;
		try {
			source = await readFile(this.file, 'utf8');
		} catch (error) {
			if (isNodeError(error, 'ENOENT')) return {};
			throw error;
		}
		const value = JSON.parse(source) as unknown;
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`Pi credential file must contain an object: ${this.file}`);
		}
		return value as Record<string, Credential>;
	}

	private async writeAll(credentials: Record<string, Credential>): Promise<void> {
		await mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		try {
			const handle = await open(temporary, 'wx', 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
			} finally {
				await handle.close();
			}
			await rename(temporary, this.file);
			await chmod(this.file, 0o600);
		} finally {
			await rm(temporary, { force: true });
		}
	}

	private async withLock<T>(run: () => Promise<T>): Promise<T> {
		await mkdir(path.dirname(this.file), { recursive: true });
		const lockFile = `${this.file}.lock`;
		const deadline = Date.now() + LOCK_TIMEOUT_MS;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		while (!handle) {
			try {
				handle = await open(lockFile, 'wx', 0o600);
			} catch (error) {
				if (!isNodeError(error, 'EEXIST')) throw error;
				const lockStat = await stat(lockFile).catch(() => undefined);
				if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
					await rm(lockFile, { force: true });
					continue;
				}
				if (Date.now() >= deadline)
					throw new Error(`Timed out locking Pi credentials: ${this.file}`);
				await delay(LOCK_RETRY_MS);
			}
		}
		try {
			return await run();
		} finally {
			await handle.close();
			await rm(lockFile, { force: true });
		}
	}
}

function expandHome(value: string): string {
	return value === '~'
		? homedir()
		: value.startsWith('~/')
			? path.join(homedir(), value.slice(2))
			: value;
}

function isNodeError(error: unknown, code: string): boolean {
	return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
