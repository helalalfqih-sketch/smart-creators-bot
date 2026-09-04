import { Buffer } from 'buffer';
import EventEmitter from 'events';

if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
  (window as any).EventEmitter = EventEmitter;
  (window as any).process = (window as any).process || { env: { NODE_ENV: 'development' } };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).Buffer = Buffer;
  (globalThis as any).global = globalThis;
  (globalThis as any).EventEmitter = EventEmitter;
}

export { Buffer, EventEmitter };
