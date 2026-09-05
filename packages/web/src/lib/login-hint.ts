export interface LoginHint {
  userId: string;
  password: string;
}

/** Both values must be deliberately public; only the Vite development UI consumes them. */
export function parseLoginHint(userId?: string, password?: string): LoginHint | null {
  const name = userId?.trim();
  if (!name || !password) return null;
  return { userId: name, password };
}

export function developmentLoginHint(): LoginHint | null {
  if (!import.meta.env.DEV) return null;
  return parseLoginHint(
    import.meta.env.VITE_PUBLIC_LOGIN_USERNAME,
    import.meta.env.VITE_PUBLIC_LOGIN_PASSWORD,
  );
}
