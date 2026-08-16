from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


source_path = Path("packages/agents-realtime/src/openaiRealtimeBase.ts")
source = source_path.read_text()

source = replace_once(
    source,
    """      outputItemId?: string;
      outputDeleted?: boolean;
      deletePhase?: 'output' | 'call';
""",
    """      outputItemId?: string;
      outputDeleted?: boolean;
      callCreateEventId?: string;
      outputCreateEventId?: string;
      deleteEventId?: string;
      deletePhase?: 'output' | 'call';
""",
    "replay event correlation fields",
)
source = replace_once(
    source,
    """  >();
  #connectionStatePrepared = false;

  protected eventEmitter: RuntimeEventEmitter<OpenAIRealtimeEventTypes> =
""",
    """  >();
  #connectionStatePrepared = false;
  #replayEventSequence = 0;

  protected eventEmitter: RuntimeEventEmitter<OpenAIRealtimeEventTypes> =
""",
    "replay event sequence",
)
source = replace_once(
    source,
    """  /** Clear state that is valid only for a single transport connection. */
  protected _resetConnectionScopedState(): void {
    this.#replayedFunctionCalls.clear();
  }

  protected get _rawSessionConfig(): Record<string, any> | null {
""",
    """  /** Clear state that is valid only for a single transport connection. */
  protected _resetConnectionScopedState(): void {
    this.#replayedFunctionCalls.clear();
  }

  #nextReplayEventId(
    callId: string,
    operation: 'call-create' | 'output-create' | 'output-delete' | 'call-delete',
  ): string {
    this.#replayEventSequence += 1;
    return `agents-realtime-history-${operation}-${callId}-${this.#replayEventSequence}`;
  }

  protected get _rawSessionConfig(): Record<string, any> | null {
""",
    "replay event id helper",
)
source = replace_once(
    source,
    """    if (parsed.type === 'error') {
      this.emit('error', { type: 'error', error: parsed });
    } else {
      this.emit(parsed.type, parsed);
    }
""",
    """    if (parsed.type === 'error') {
      const failedClientEventId =
        parsed.error && typeof parsed.error === 'object'
          ? (parsed.error as { event_id?: unknown }).event_id
          : undefined;
      if (typeof failedClientEventId === 'string') {
        for (const [callId, tracked] of this.#replayedFunctionCalls) {
          if (tracked.callCreateEventId === failedClientEventId) {
            this.#replayedFunctionCalls.delete(callId);
            break;
          }
          if (tracked.outputCreateEventId === failedClientEventId) {
            tracked.outputCreateEventId = undefined;
            tracked.expectsOutput = false;
            tracked.outputItemId = undefined;
            tracked.outputDeleted = false;
            tracked.item = realtimeToolCallItem.parse({
              ...tracked.item,
              status: 'in_progress',
              output: null,
            });
            break;
          }
          if (tracked.deleteEventId === failedClientEventId) {
            tracked.deleteEventId = undefined;
            tracked.deletePhase = undefined;
            break;
          }
        }
      }
      this.emit('error', { type: 'error', error: parsed });
    } else {
      this.emit(parsed.type, parsed);
    }
""",
    "async provider error correlation",
)
source = replace_once(
    source,
    """        if (tracked) {
          const previousItemId =
""",
    """        if (tracked) {
          tracked.callCreateEventId = undefined;
          const previousItemId =
""",
    "function call acknowledgement",
)
source = replace_once(
    source,
    """        if (tracked) {
          tracked.expectsOutput = true;
          tracked.outputDeleted = false;
""",
    """        if (tracked) {
          tracked.expectsOutput = true;
          tracked.outputDeleted = false;
          tracked.outputCreateEventId = undefined;
""",
    "function output acknowledgement",
)
source = replace_once(
    source,
    """          tracked.outputDeleted = true;
          tracked.outputItemId = undefined;
          tracked.deletePhase = undefined;
          this.sendEvent({
            type: 'conversation.item.delete',
            item_id: callId,
          });
          tracked.deletePhase = 'call';
          break;
""",
    """          tracked.outputDeleted = true;
          tracked.outputItemId = undefined;
          tracked.deleteEventId = undefined;
          tracked.deletePhase = undefined;
          const callDeleteEventId = this.#nextReplayEventId(
            callId,
            'call-delete',
          );
          this.sendEvent({
            type: 'conversation.item.delete',
            event_id: callDeleteEventId,
            item_id: callId,
          });
          tracked.deletePhase = 'call';
          tracked.deleteEventId = callDeleteEventId;
          break;
""",
    "chained call deletion correlation",
)
source = replace_once(
    source,
    """    for (const deletion of initialDeletes) {
      const tracked = deletion.trackedCallId
        ? this.#replayedFunctionCalls.get(deletion.trackedCallId)
        : undefined;
      this.sendEvent({
        type: 'conversation.item.delete',
        item_id: deletion.itemId,
      });
      if (tracked && deletion.phase) {
        tracked.deletePhase = deletion.phase;
      }
    }
""",
    """    for (const deletion of initialDeletes) {
      const tracked = deletion.trackedCallId
        ? this.#replayedFunctionCalls.get(deletion.trackedCallId)
        : undefined;
      const deleteEventId =
        tracked && deletion.phase && deletion.trackedCallId
          ? this.#nextReplayEventId(
              deletion.trackedCallId,
              deletion.phase === 'output' ? 'output-delete' : 'call-delete',
            )
          : undefined;
      this.sendEvent({
        type: 'conversation.item.delete',
        ...(deleteEventId ? { event_id: deleteEventId } : {}),
        item_id: deletion.itemId,
      });
      if (tracked && deletion.phase) {
        tracked.deletePhase = deletion.phase;
        tracked.deleteEventId = deleteEventId;
      }
    }
""",
    "initial deletion correlation",
)
source = replace_once(
    source,
    """      } else if (addition.type === 'function_call') {
        const callId = addition.itemId;
        this.#replayedFunctionCalls.set(callId, {
          item: addition,
          expectsOutput: addition.output !== null,
        });
        let callCreateSent = false;
        try {
          this.sendEvent({
            type: 'conversation.item.create',
            item: {
              type: 'function_call',
              id: addition.itemId,
              call_id: callId,
              name: addition.name,
              arguments: addition.arguments,
              status: addition.status,
            },
          });
          callCreateSent = true;
          if (addition.output !== null) {
            this.sendEvent({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: addition.output,
              },
            });
          }
        } catch (error) {
          if (!callCreateSent) {
            this.#replayedFunctionCalls.delete(callId);
          }
          throw error;
        }
      }
""",
    """      } else if (addition.type === 'function_call') {
        const callId = addition.itemId;
        const callCreateEventId = this.#nextReplayEventId(
          callId,
          'call-create',
        );
        const tracked = {
          item: addition,
          expectsOutput: addition.output !== null,
          callCreateEventId,
        };
        this.#replayedFunctionCalls.set(callId, tracked);
        let callCreateSent = false;
        try {
          this.sendEvent({
            type: 'conversation.item.create',
            event_id: callCreateEventId,
            item: {
              type: 'function_call',
              id: addition.itemId,
              call_id: callId,
              name: addition.name,
              arguments: addition.arguments,
              status: addition.status,
            },
          });
          callCreateSent = true;
          if (addition.output !== null) {
            const outputCreateEventId = this.#nextReplayEventId(
              callId,
              'output-create',
            );
            tracked.outputCreateEventId = outputCreateEventId;
            this.sendEvent({
              type: 'conversation.item.create',
              event_id: outputCreateEventId,
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: addition.output,
              },
            });
          }
        } catch (error) {
          if (!callCreateSent) {
            this.#replayedFunctionCalls.delete(callId);
          } else if (tracked.outputCreateEventId) {
            tracked.outputCreateEventId = undefined;
            tracked.expectsOutput = false;
            tracked.item = realtimeToolCallItem.parse({
              ...tracked.item,
              status: 'in_progress',
              output: null,
            });
          }
          throw error;
        }
      }
""",
    "correlated function call replay creation",
)
source_path.write_text(source)


replay_test_path = Path(
    "packages/agents-realtime/test/functionCallHistoryReplay.test.ts"
)
test = replay_test_path.read_text()

test = replace_once(
    test,
    """function echoDeleted(base: TestBase, itemId: string) {
  receive(base, {
    type: 'conversation.item.deleted',
    event_id: `evt_delete_${itemId}`,
    item_id: itemId,
  });
}
""",
    """function echoDeleted(base: TestBase, itemId: string) {
  receive(base, {
    type: 'conversation.item.deleted',
    event_id: `evt_delete_${itemId}`,
    item_id: itemId,
  });
}

function echoClientEventError(base: TestBase, clientEventId: string) {
  receive(base, {
    type: 'error',
    event_id: `server_error_${clientEventId}`,
    error: {
      type: 'invalid_request_error',
      message: 'rejected client event',
      event_id: clientEventId,
    },
  });
}
""",
    "error test helper",
)

# Existing exact payload assertions now include a client-generated event_id.
test = test.replace(
    """        type: 'conversation.item.create',
        item: {
          type: 'function_call',
""",
    """        type: 'conversation.item.create',
        event_id: expect.any(String),
        item: {
          type: 'function_call',
""",
    2,
)
test = replace_once(
    test,
    """      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
""",
    """      {
        type: 'conversation.item.create',
        event_id: expect.any(String),
        item: {
          type: 'function_call_output',
""",
    "completed replay output expectation",
)
# Every tracked function-call deletion now carries a correlation event id.
test = test.replace(
    """{ type: 'conversation.item.delete', item_id: 'fco_1' }""",
    """{
        type: 'conversation.item.delete',
        event_id: expect.any(String),
        item_id: 'fco_1',
      }""",
)
test = test.replace(
    """{ type: 'conversation.item.delete', item_id: 'fc_1' }""",
    """{
        type: 'conversation.item.delete',
        event_id: expect.any(String),
        item_id: 'fc_1',
      }""",
)

new_tests = r'''

  it('releases replay ownership after an asynchronous call-create rejection', () => {
    const base = new TestBase();
    const call = functionCall();
    base.resetHistory([], [call]);
    const failedEventId = base.events[0].event_id;
    expect(failedEventId).toEqual(expect.any(String));

    echoClientEventError(base, failedEventId);
    base.events = [];

    expect(() => base.resetHistory([], [call])).not.toThrow();
    expect(base.events).toHaveLength(1);
    expect(base.events[0].event_id).not.toBe(failedEventId);
  });

  it('transitions a rejected replay output so the acknowledged call can be removed', () => {
    const base = new TestBase();
    const call = functionCall({ output: '{"temp":21}' });
    base.resetHistory([], [call]);
    const outputEventId = base.events[1].event_id;
    expect(outputEventId).toEqual(expect.any(String));

    echoClientEventError(base, outputEventId);
    echoFunctionCall(base);
    base.events = [];

    const projectedCall = functionCall();
    base.resetHistory([projectedCall], []);
    expect(base.events).toEqual([
      {
        type: 'conversation.item.delete',
        event_id: expect.any(String),
        item_id: 'fc_1',
      },
    ]);
  });

  it('retries tracked deletions after asynchronous provider rejection', () => {
    const base = new TestBase();
    const call = functionCall({ output: '{"temp":21}' });
    base.resetHistory([], [call]);
    echoFunctionCall(base);
    echoFunctionCallOutput(base);
    base.events = [];

    base.resetHistory([call], []);
    const outputDeleteEventId = base.events[0].event_id;
    expect(outputDeleteEventId).toEqual(expect.any(String));
    echoClientEventError(base, outputDeleteEventId);
    base.events = [];

    base.resetHistory([call], []);
    expect(base.events).toEqual([
      {
        type: 'conversation.item.delete',
        event_id: expect.any(String),
        item_id: 'fco_1',
      },
    ]);

    echoDeleted(base, 'fco_1');
    const callDeleteEventId = base.events.at(-1)?.event_id;
    expect(callDeleteEventId).toEqual(expect.any(String));
    echoClientEventError(base, callDeleteEventId);
    base.events = [];

    base.resetHistory([call], []);
    expect(base.events).toEqual([
      {
        type: 'conversation.item.delete',
        event_id: expect.any(String),
        item_id: 'fc_1',
      },
    ]);
  });
'''
marker = "\n});\n"
pos = test.rfind(marker)
if pos < 0:
    raise RuntimeError("replay test insertion marker not found")
test = test[:pos] + new_tests + test[pos:]
replay_test_path.write_text(test)


base_test_path = Path("packages/agents-realtime/test/openaiRealtimeBase.test.ts")
base_test = base_test_path.read_text()
base_test = replace_once(
    base_test,
    """      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call',
          id: 'f1',
""",
    """      {
        type: 'conversation.item.create',
        event_id: expect.any(String),
        item: {
          type: 'function_call',
          id: 'f1',
""",
    "base function call replay expectation",
)
base_test_path.write_text(base_test)
