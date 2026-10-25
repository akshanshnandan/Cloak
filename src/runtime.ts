import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat, rename, access, readdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import path from 'node:path';

const BUILD = 'b11887';
const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';
const MODEL_SHA = 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5';
const MODEL_SIZE = 1282439264;
const ARCHIVE_SHA = '21aacee44771431a4d13a66988e31a65207aefb9c74b9098b2100e597cbe6cc9';
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function checksum(file: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function download(url: string, file: string, sha: string, size: number, progress: (value: number) => void) {
  if ((await stat(file).catch(() => null))?.size === size) return;
  await mkdir(path.dirname(file), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  let bytes = 0, previous = -1; const hash = createHash('sha256');
  await pipeline(Readable.fromWeb(response.body as any), new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; hash.update(chunk); const percent = Math.floor(bytes / size * 100);
    if (percent !== previous) { previous = percent; progress(percent); } done(null, chunk);
  }}), createWriteStream(file + '.partial'));
  if (bytes !== size || hash.digest('hex') !== sha) throw new Error('Downloaded AI files failed checksum verification');
  await rename(file + '.partial', file);
}
async function findExecutable(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === 'llama-server.exe') return file;
    if (entry.isDirectory()) { const nested = await findExecutable(file); if (nested) return nested; }
  }
}
export class LlamaRuntime {
  private child?: ChildProcess;
  private token = randomBytes(24).toString('hex');
  private base = '';
  private tail = '';
  private closed = false;
  async start(directory: string, changed: (message: string, progress: number) => void) {
    let executable = process.env.CLOAK_LLAMA_SERVER;
    const runtimeDirectory = path.join(directory, 'runtime', BUILD);
    const modelFile = process.env.CLOAK_GGUF_MODEL || path.join(directory, 'models', MODEL_FILE);
    if (!executable) {
      if (process.platform !== 'win32') throw new Error('Set CLOAK_LLAMA_SERVER to your local llama-server executable on this platform');
      await mkdir(runtimeDirectory, { recursive: true });
      executable = await findExecutable(runtimeDirectory);
      if (!executable) {
        const archive = path.join(directory, 'runtime', `llama-${BUILD}-vulkan.zip`);
        await download(`https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/llama-${BUILD}-bin-win-vulkan-x64.zip`, archive, ARCHIVE_SHA, 37039849, n => changed('Preparing local AI', n));
        // A fixed upstream build is verified before extraction or execution.
        if (await checksum(archive) !== ARCHIVE_SHA) throw new Error('AI runtime checksum mismatch');
        const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(runtimeDirectory)} -Force`], { windowsHide: true });
        executable = await findExecutable(runtimeDirectory);
      }
    }
    if (!executable) throw new Error('The local AI runtime is missing');
    if (!process.env.CLOAK_GGUF_MODEL) await download(`https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/${MODEL_FILE}`, modelFile, MODEL_SHA, MODEL_SIZE, n => changed('Downloading local AI', n));
    if (this.closed) throw new Error('Local AI startup was cancelled');
    changed('Starting local AI', 100);
    const port = await new Promise<number>(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = (socket.address() as any).port; socket.close(() => resolve(port)); }); });
    this.base = `http://127.0.0.1:${port}`;
    const args = ['--model', modelFile, '--host', '127.0.0.1', '--port', String(port), '--api-key', this.token, '--ctx-size', '4096', '--parallel', '1', '--threads', '6', '--n-gpu-layers', process.env.CLOAK_CPU === '1' ? '0' : '99', '--no-webui', '--jinja', '--reasoning', 'off', '--chat-template-kwargs', '{"enable_thinking":false}'];
    this.child = spawn(executable, args, { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.stderr?.on('data', chunk => { this.tail = (this.tail + String(chunk)).slice(-5000); });
    this.child.on('error', error => { this.tail += error.message; });
    const cleanup = () => this.child?.kill(); process.once('exit', cleanup);
    this.child.once('exit', () => process.off('exit', cleanup));
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (this.closed || this.child.exitCode !== null) throw new Error(`Local AI could not start. ${this.tail.slice(-1500)}`);
      try { const response = await fetch(this.base + '/health', { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(1500) }); if (response.ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    this.close(); throw new Error('Local AI startup timed out');
  }
  async generate(messages: { role: string; content: string }[], schema: unknown): Promise<string> {
    const response = await fetch(this.base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` }, body: JSON.stringify({ messages, temperature: 0, max_tokens: 320, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object', schema }, cache_prompt: true }), signal: AbortSignal.timeout(90000) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(result.error?.message || 'Local AI inference failed');
    return result.choices?.[0]?.message?.content || '';
  }
  close() { this.closed = true; this.child?.kill(); this.child = undefined; }
}
