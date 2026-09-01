import { describe, expect, it } from 'vitest';
import { consumeQrLoginStream } from '../../src/session/qr-stream.js';

const encoder = new TextEncoder();

describe('QR SSE parser', () => {
  it('игнорирует повреждённый кадр и продолжает поток', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {broken}\n\n'));
        controller.enqueue(encoder.encode('data: null\n\n'));
        controller.enqueue(encoder.encode('data: {"status":"future"}\n\n'));
        controller.enqueue(encoder.encode('data: {"status":"scanned","expiresIn":120}\n\n'));
        controller.close();
      },
    });
    const events: unknown[] = [];

    await consumeQrLoginStream(body, (event) => {
      events.push(event);
    });

    expect(events).toEqual([{ status: 'scanned', expiresIn: 120 }]);
  });

  it('отменяет заблокированное чтение по AbortSignal', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const controller = new AbortController();
    const reason = new Error('stop QR stream');
    const pending = consumeQrLoginStream(body, () => {}, controller.signal);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(canceled).toBe(true);
  });
});
