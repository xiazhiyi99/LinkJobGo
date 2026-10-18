const sessionCookieConfig = (env = process.env) => {
  const name = env.SESSION_COOKIE_NAME || 'lingke_session';
  const path = env.SESSION_COOKIE_PATH || '/';
  if (!/^[a-zA-Z0-9_]+$/.test(name) || !/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(path)) throw new Error('Invalid session cookie configuration');
  return { name, path };
};
module.exports = { sessionCookieConfig };
