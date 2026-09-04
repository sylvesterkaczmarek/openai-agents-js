import { describe, expect, it } from 'vitest';
import { getOpenFileInvocation } from '../../examples/tools/open-file-command';

describe('image generation example file opener', () => {
  it('uses open on macOS', () => {
    expect(getOpenFileInvocation('/tmp/image.png', 'darwin', {})).toEqual({
      command: 'open',
      args: ['/tmp/image.png'],
    });
  });

  it('uses xdg-open off macOS and Windows', () => {
    expect(getOpenFileInvocation('/tmp/image.png', 'linux', {})).toEqual({
      command: 'xdg-open',
      args: ['/tmp/image.png'],
    });
  });

  it('spawns cmd.exe directly on Windows and keeps the path as one argument', () => {
    const filePath = 'C:\\Temp\\generated image & preview.png';

    expect(getOpenFileInvocation(filePath, 'win32', {})).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'start', '', filePath],
    });
  });

  it('honors ComSpec on Windows', () => {
    expect(
      getOpenFileInvocation('C:\\Temp\\image.png', 'win32', {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toMatchObject({
      command: 'C:\\Windows\\System32\\cmd.exe',
    });
  });
});
