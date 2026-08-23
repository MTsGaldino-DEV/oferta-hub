import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { AppSidebar } from './app-sidebar.js';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar.js';

export function Layout({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState(0);
  const [wa, setWa] = useState<{ status: string; quota: { used: number; cap: number } } | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.get<{ pending: number }>('/api/stats/overview?days=30').then((s) => setPending(s.pending)).catch(() => {});
    api.get<any>('/api/whatsapp/status').then(setWa).catch(() => {});
  }, [location.pathname]);

  async function logout() {
    await api.post('/api/logout');
    window.location.href = '/';
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '13rem' } as React.CSSProperties}>
      <AppSidebar
        pending={pending}
        online={wa?.status === 'connected'}
        quota={wa?.quota ?? null}
        onLogout={() => void logout()}
      />
      <SidebarInset className="main">
        <SidebarTrigger className="mb-3" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
