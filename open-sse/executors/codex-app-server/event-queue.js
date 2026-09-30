// Async event queue feeding the Responses SSE bridge.
//
// Ported from OmniRoute's open-sse/vendor/codex-chatgpt-web/event-queue.ts
// (types stripped). Adapted from miuuyy/codex-chatgpt-web (MIT).

export class AsyncEventQueue {
  constructor(maxBuffered = 10_000) {
    this.buffered = [];
    this.waiters = [];
    this.closed = false;
    this.maxBuffered = maxBuffered;
  }

  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    if (this.buffered.length >= this.maxBuffered) throw new Error("Adapter event backlog exceeded");
    this.buffered.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()({ value: undefined, done: true });
  }

  async collect() {
    const values = [];
    for await (const value of this) values.push(value);
    return values;
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        const value = this.buffered.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
