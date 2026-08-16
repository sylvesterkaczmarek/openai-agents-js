from pathlib import Path

path = Path("packages/agents-realtime/test/functionCallHistoryReplay.test.ts")
test = path.read_text()
old = """function echoClientEventError(base: TestBase, clientEventId: string) {
  receive(base, {
"""
new = """function echoClientEventError(base: TestBase, clientEventId: string) {
  base.on('error', () => {});
  receive(base, {
"""
count = test.count(old)
if count != 1:
    raise RuntimeError(f"expected one error helper match, found {count}")
path.write_text(test.replace(old, new, 1))
