import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';

export function createWorker(root, ffprobe, handoff, legacyRoot) {
  let worker;
  let closed = false;

  function start() {
    const secret = randomBytes(32).toString('hex');
    const ffmpeg = isAbsolute(ffprobe || '') ? join(dirname(ffprobe), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : undefined;
    const child = fork(fileURLToPath(new URL('../service/worker.cjs', import.meta.url)), [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
      env: { ...process.env, ...(ffprobe ? { FFPROBE: ffprobe } : {}),
        ...(ffmpeg ? { FFMPEG: ffmpeg } : {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    });
    const state = { child };
    worker = state;
    state.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker startup timed out'));
        child.kill();
      }, 8000);
      function failed(error) {
        clearTimeout(timeout);
        if (worker === state) worker = undefined;
        reject(error);
      }
      child.on('error', failed);
      child.once('exit', () => failed(new Error('Worker exited')));
      child.once('message', (message) => {
        if(message?.type==='startup-error'&&['DATA_ROOT_BUSY','SCHEMA_UNSUPPORTED','WORKER_START_FAILED'].includes(message.code)){
          failed(Object.assign(new Error(message.code),{code:message.code}));child.kill();return;
        }
        if (message?.type !== 'ready' || message.protocol !== 1 ||
            !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          failed(new Error('Invalid worker handshake'));
          child.kill();
          return;
        }
        clearTimeout(timeout);
        resolve({ base: 'http://127.0.0.1:' + message.port, secret });
      });
      child.send({ root, secret, handoff, legacyRoot }, (error) => {
        if (!error) return;
        failed(error);
        child.kill();
      });
    });
    return state;
  }

  return {
    async call(route, method, body, options = {}) {
      if (closed) throw new Error('Plugin is closed');
      const { base, secret } = await (worker || start()).ready;
      return fetch(base + route, {
        method,
        headers: {
          'x-cutdirector-worker': secret,
          'Content-Type': options.contentType || 'application/json',
          ...(options.range ? { Range: options.range } : {}),
        },
        body,
        ...(options.stream ? { duplex: 'half' } : {}),
        signal: options.signal || AbortSignal.timeout(10000),
      });
    },
    close() {
      closed = true;
      const child = worker?.child;
      if (!child) return;
      if (child.connected) child.disconnect();
      const timer = setTimeout(() => child.kill(), 2000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    },
  };
}
