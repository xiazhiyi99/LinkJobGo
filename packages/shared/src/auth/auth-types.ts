export type UserRole = 'user' | 'admin';
export type AuthUser = { id: string; email: string; role: UserRole; emailVerified: boolean };
