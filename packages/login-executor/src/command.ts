import { spawn } from 'node:child_process';

export interface CommandRequest {
	command: string;
	args: string[];
	stdin: string;
	cwd?: string;
	signal?: AbortSignal;
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export const runCommand: CommandRunner = (request) =>
	new Promise((resolve, reject) => {
		const child = spawn(request.command, request.args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: request.cwd,
			signal: request.signal,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
		child.stdin.end(request.stdin);
	});
