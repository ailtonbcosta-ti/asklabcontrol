import axios from 'axios';
import { useAuth } from '../stores/auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

api.interceptors.request.use(async (config) => {
  let token = useAuth.getState().access;
  // Após recarregar a página o access token (só em memória) não existe: renova antes
  // de chamar a API, em vez de esperar o 401.
  const url = config.url || '';
  if (!token && useAuth.getState().user && !url.includes('/auth/')) {
    token = await refresh();
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;
async function refresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post('/api/auth/refresh', null, { withCredentials: true })
      .then((r) => {
        useAuth.getState().setAccess(r.data.access);
        return r.data.access as string;
      })
      .catch(() => {
        useAuth.getState().clear();
        return null;
      })
      .finally(() => (refreshing = null));
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const url: string = err.config?.url || '';
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/logout');
    if (err.response?.status === 401 && err.config && !err.config._retry && !isAuthCall) {
      err.config._retry = true;
      const newToken = await refresh();
      if (newToken) {
        err.config.headers.Authorization = `Bearer ${newToken}`;
        return api(err.config);
      }
    }
    return Promise.reject(err);
  },
);
