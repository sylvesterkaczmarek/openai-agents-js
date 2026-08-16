from pathlib import Path

path = Path("packages/agents-realtime/src/openaiRealtimeBase.ts")
source = path.read_text()

replacements = [
    (
        """          try {
            this.sendEvent({
              type: 'conversation.item.delete',
              item_id: callId,
            });
            tracked.deletePhase = 'call';
          } catch (error) {
            throw error;
          }
""",
        """          this.sendEvent({
            type: 'conversation.item.delete',
            item_id: callId,
          });
          tracked.deletePhase = 'call';
""",
    ),
    (
        """      try {
        this.sendEvent({
          type: 'conversation.item.delete',
          item_id: deletion.itemId,
        });
        if (tracked && deletion.phase) {
          tracked.deletePhase = deletion.phase;
        }
      } catch (error) {
        // No acknowledgement was received, so retain replay ownership and IDs
        // for a safe retry. deletePhase is set only after a successful send.
        throw error;
      }
""",
        """      this.sendEvent({
        type: 'conversation.item.delete',
        item_id: deletion.itemId,
      });
      if (tracked && deletion.phase) {
        tracked.deletePhase = deletion.phase;
      }
""",
    ),
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"expected one lint cleanup match, found {count}")
    source = source.replace(old, new, 1)

path.write_text(source)
