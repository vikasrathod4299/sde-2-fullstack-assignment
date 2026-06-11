import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserProfile {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  token: string | null;
  profile: UserProfile | null;
  login: (token: string, profile: UserProfile) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      profile: null,
      login: (token, profile) => set({ token, profile }),
      logout: () => set({ token: null, profile: null }),
      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'auth-storage',
    }
  )
);
