export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (scope: string) => Logger;
}

function createScopedLogger(scopes: string[]): Logger {
  const prefix = scopes.length > 0 ? `[${scopes.join(':')}]` : '';

  const write = (level: 'info' | 'warn' | 'error', ...args: unknown[]): void => {
    if (level === 'warn') {
      if (prefix) console.warn(prefix, ...args);
      else console.warn(...args);
      return;
    }

    if (level === 'error') {
      if (prefix) console.error(prefix, ...args);
      else console.error(...args);
      return;
    }

    if (prefix) console.log(prefix, ...args);
    else console.log(...args);
  };

  return {
    info: (...args: unknown[]) => write('info', ...args),
    warn: (...args: unknown[]) => write('warn', ...args),
    error: (...args: unknown[]) => write('error', ...args),
    child: (scope: string) => createScopedLogger([...scopes, scope]),
  };
}

export function createLogger(scope?: string): Logger {
  return createScopedLogger(scope ? [scope] : []);
}
