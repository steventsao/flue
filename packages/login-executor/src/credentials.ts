import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

/** Resolve the Pi coding-agent auth file when present, then local auth.json. */
export function defaultPiAuthFile(): string {
	const configured = process.env.FLUE_PI_AUTH_FILE;
	if (configured) return path.resolve(expandHome(configured));
	const codingAgent = path.join(homedir(), '.pi', 'agent', 'auth.json');
	return existsSync(codingAgent) ? codingAgent : path.resolve('auth.json');
}

/** Serialized, atomically persisted store compatible with Pi's auth.json. */
export class JsonCredentialStore implements CredentialStore {
	readonly file: string;
	private tail = Promise.resolve();

	constructor(file = defaultPiAuthFile()) {
		this.file = path.resolve(expandHome(file));
	}

	async read(providerId: string): Promise<Credential | undefined> {
		await this.tail;
		return (await this.readAll())[providerId];
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.serialized(async () => {
			const credentials = await this.readAll();
			const next = await fn(credentials[providerId]);
			if (next === undefined) return credentials[providerId];
			credentials[providerId] = next;
			await this.writeAll(credentials);
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.serialized(async () => {
			const credentials = await this.readAll();
			if (!(providerId in credentials)) return;
			delete credentials[providerId];
			await this.writeAll(credentials);
		});
	}

	private async serialized<T>(run: () => Promise<T>): Promise<T> {
		const previous = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await run();
		} finally {
			release();
		}
	}

	private async readAll(): Promise<Record<string, Credential>> {
		try {
			const value = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new TypeError(`Pi credential file must contain an object: ${this.file}`);
			}
			return value as Record<string, Credential>;
		} catch (error) {
			if (isNodeError(error, 'ENOENT')) return {};
			throw error;
		}
	}

	private async writeAll(credentials: Record<string, Credential>): Promise<void> {
		await mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			});
			await rename(temporary, this.file);
			await chmod(this.file, 0o600);
		} finally {
			await rm(temporary, { force: true });
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
