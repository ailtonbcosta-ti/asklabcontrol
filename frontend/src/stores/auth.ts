import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'ADMIN' | 'GESTOR' | 'OPERADOR';
export interface User { id: number; nome: string; email: string; role: Role; }

interface AuthState {
  user: User | null;
  access: string | null;
  setSession: (u: User, t: string) => void;
  setAccess: (t: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      access: null,
      setSession: (u, t) => set({ user: u, access: t }),
      setAccess: (t) => set({ access: t }),
      clear: () => set({ user: null, access: null }),
    }),
    { name: 'asklab.auth' },
  ),
);
