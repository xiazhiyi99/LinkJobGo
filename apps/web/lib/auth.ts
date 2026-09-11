export const AUTH_COOKIE = 'lingke_session';
export const isAuthenticated = () => typeof document !== 'undefined' && document.cookie.includes(`${AUTH_COOKIE}=`);
