export type OpenFileInvocation = {
  command: string;
  args: string[];
};

export function getOpenFileInvocation(
  filePath: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): OpenFileInvocation {
  if (platform === 'darwin') {
    return { command: 'open', args: [filePath] };
  }

  if (platform === 'win32') {
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'start', '', filePath],
    };
  }

  return { command: 'xdg-open', args: [filePath] };
}
