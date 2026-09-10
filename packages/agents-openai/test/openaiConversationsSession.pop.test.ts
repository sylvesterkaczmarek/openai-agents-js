import { setImmediate } from 'node:timers/promises';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAIConversationsSession } from '../src';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(failFirstDelete = false) {
  const records = [1, 2].map((id) => ({
    id: `message-${id}`,
    type: 'message' as const,
    role: 'user' as const,
    content: [{ type: 'input_text' as const, text: `message ${id}` }],
  }));
  const firstDelete = deferred();
  const release = deferred();
  const operations: string[] = [];
  let deletions = 0;
  const client = new OpenAI({
    apiKey: 'test-key',
    baseURL: 'https://example.invalid/v1',
    maxRetries: 0,
    // Keep the real SDK request, pagination, and item-conversion paths. Only the remote API is replaced.
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const id = url.pathname.split('/').at(-1)!;
      operations.push(`${method} ${id}`);
      if (method === 'GET' && id === 'items') {
        return Response.json({
          object: 'list',
          data: [...records].reverse().slice(0, 1),
          has_more: false,
          first_id: records.at(-1)?.id,
          last_id: records.at(-1)?.id,
        });
      }
      if (method === 'DELETE' && id.startsWith('message-')) {
        deletions += 1;
        if (deletions === 1) {
          firstDelete.resolve();
          await release.promise;
          if (failFirstDelete) {
            return Response.json(
              { error: { message: 'delete failed' } },
              { status: 503 },
            );
          }
        }
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) {
          return Response.json(
            { error: { message: 'item not found' } },
            { status: 404 },
          );
        }
        records.splice(index, 1);
        return Response.json({
          id,
          object: 'conversation.item.deleted',
          deleted: true,
        });
      }
      if (method === 'DELETE' && id === 'conversation-1') {
        records.length = 0;
        return Response.json({
          id,
          object: 'conversation.deleted',
          deleted: true,
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    },
  });
  return {
    session: new OpenAIConversationsSession({
      client,
      conversationId: 'conversation-1',
    }),
    records,
    operations,
    firstDelete,
    release,
  };
}

describe('OpenAIConversationsSession concurrent pops', () => {
  it('removes a distinct newest item for each concurrent pop', async () => {
    const { session, records, operations, firstDelete, release } = fixture();
    const first = session.popItem();
    await firstDelete.promise;
    const second = session.popItem();
    const settled = Promise.allSettled([first, second]);
    try {
      await setImmediate();
      expect(operations).toEqual(['GET items', 'DELETE message-2']);
      release.resolve();
      expect(await settled).toMatchObject([
        { status: 'fulfilled', value: { id: 'message-2' } },
        { status: 'fulfilled', value: { id: 'message-1' } },
      ]);
      expect(records).toEqual([]);
      expect(await session.popItem()).toBeUndefined();
    } finally {
      release.resolve();
      await settled;
    }
  });

  it('lets a queued pop retry the current tail after an earlier delete fails', async () => {
    const { session, records, firstDelete, release } = fixture(true);
    const first = session.popItem();
    await firstDelete.promise;
    const second = session.popItem();
    const settled = Promise.allSettled([first, second]);
    try {
      await setImmediate();
      release.resolve();
      expect(await settled).toMatchObject([
        { status: 'rejected', reason: { status: 503 } },
        { status: 'fulfilled', value: { id: 'message-2' } },
      ]);
      expect(records.map((item) => item.id)).toEqual(['message-1']);
    } finally {
      release.resolve();
      await settled;
    }
  });

  it('drains queued pops before clearing the conversation', async () => {
    const { session, operations, firstDelete, release } = fixture();
    const first = session.popItem();
    await firstDelete.promise;
    const second = session.popItem();
    const clear = session.clearSession();
    const settled = Promise.allSettled([first, second, clear]);
    try {
      await setImmediate();
      expect(operations).toEqual(['GET items', 'DELETE message-2']);
      release.resolve();
      expect(await settled).toMatchObject([
        { status: 'fulfilled', value: { id: 'message-2' } },
        { status: 'fulfilled', value: { id: 'message-1' } },
        { status: 'fulfilled' },
      ]);
      expect(operations).toEqual([
        'GET items',
        'DELETE message-2',
        'GET items',
        'DELETE message-1',
        'DELETE conversation-1',
      ]);
      expect(session.sessionId).toBeUndefined();
    } finally {
      release.resolve();
      await settled;
    }
  });
});
