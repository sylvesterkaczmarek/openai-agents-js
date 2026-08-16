from pathlib import Path

path = Path("packages/agents-realtime/src/openaiRealtimeBase.ts")
source = path.read_text()
old = """        const tracked = {
          item: addition,
          expectsOutput: addition.output !== null,
          callCreateEventId,
        };
"""
new = """        const tracked = {
          item: addition,
          expectsOutput: addition.output !== null,
          callCreateEventId,
          outputCreateEventId: undefined as string | undefined,
        };
"""
count = source.count(old)
if count != 1:
    raise RuntimeError(f"expected one tracked replay object, found {count}")
path.write_text(source.replace(old, new, 1))
