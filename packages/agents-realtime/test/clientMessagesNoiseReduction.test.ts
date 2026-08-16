import { describe, expect, it, vi } from 'vitest';
import { toNewSessionConfig } from '../src/clientMessages';
import { OpenAIRealtimeBase } from '../src/openaiRealtimeBase';

class TestRealtimeTransport extends OpenAIRealtimeBase {
  status: 'connected' | 'disconnected' | 'connecting' | 'disconnecting' =
    'connected';
  connect = vi.fn(async () => {});
  sendEvent = vi.fn();
  mute = vi.fn();
  close = vi.fn();
  interrupt = vi.fn();
  get muted() {
    return false;
  }
}

describe('Realtime GA audio config conversion', () => {
  it('does not disable noise reduction when the caller only sets input format', () => {
    const config = toNewSessionConfig({
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
        },
      },
    });

    expect(config.audio?.input?.noiseReduction).toBeUndefined();
    expect(JSON.parse(JSON.stringify(config.audio?.input))).not.toHaveProperty(
      'noiseReduction',
    );
  });

  it('preserves explicit noise reduction disable and configuration values', () => {
    const disabled = toNewSessionConfig({
      audio: { input: { noiseReduction: null } },
    });
    const enabled = toNewSessionConfig({
      audio: { input: { noiseReduction: { type: 'near_field' } } },
    });

    expect(disabled.audio?.input?.noiseReduction).toBeNull();
    expect(enabled.audio?.input?.noiseReduction).toEqual({
      type: 'near_field',
    });
  });

  it('preserves omission in the emitted session payload', () => {
    const transport = new TestRealtimeTransport();
    const payload = transport.buildSessionPayload({
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
        },
      },
    });

    expect(payload.audio.input.noise_reduction).toBeUndefined();
    expect(JSON.parse(JSON.stringify(payload.audio.input))).not.toHaveProperty(
      'noise_reduction',
    );
  });

  it('keeps the default and explicit null behavior at the payload boundary', () => {
    const transport = new TestRealtimeTransport();

    expect(
      transport.buildSessionPayload({}).audio.input.noise_reduction,
    ).toBeNull();
    expect(
      transport.buildSessionPayload({
        audio: { input: { noiseReduction: null } },
      }).audio.input.noise_reduction,
    ).toBeNull();
  });
});
