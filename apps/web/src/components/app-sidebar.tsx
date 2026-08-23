import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  Eye,
  LayoutDashboard,
  ListChecks,
  Search,
  Send,
  Settings,
  Tags,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { Logo } from './Logo.js';
import { Button } from './ui/button.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar.js';

type NavItem = { to: string; label: string; end?: boolean; icon: LucideIcon };

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard }] },
  { label: null, items: [{ to: '/fila', label: 'Fila', icon: ListChecks }] },
  {
    label: 'Catálogo',
    items: [
      { to: '/garimpar', label: 'Garimpar', icon: Search },
      { to: '/nichos', label: 'Nichos', icon: Tags },
      { to: '/produtos', label: 'Preços vigiados', icon: Eye },
    ],
  },
  {
    label: 'Automação',
    items: [
      { to: '/agenda', label: 'Agenda', icon: CalendarClock },
      { to: '/automacoes', label: 'Automações', icon: Workflow },
      { to: '/disparos', label: 'Disparos', icon: Send },
    ],
  },
  {
    label: 'Métricas',
    items: [
      { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
      { to: '/grupos', label: 'Meus Grupos', icon: Users },
    ],
  },
  { label: 'Configurações', items: [{ to: '/configuracoes', label: 'Configurações', icon: Settings }] },
];

interface AppSidebarProps {
  pending: number;
  online: boolean;
  quota: { used: number; cap: number } | null;
  onLogout: () => void;
}

export function AppSidebar({ pending, online, quota, onLogout }: AppSidebarProps) {
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Logo size={28} className="shrink-0 text-[var(--brand)]" />
          <span className="text-[15px] font-extrabold leading-none tracking-tight group-data-[collapsible=icon]:hidden">
            Hub<span className="text-[var(--brand)]">Ofertas</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((g, gi) => (
          <SidebarGroup key={gi}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  // Mesmo algoritmo de match do NavLink (end = exato,
                  // senao prefixo) -- so precisamos disso fora do NavLink
                  // porque SidebarMenuButton pinta o estado ativo via prop,
                  // nao via className/aria-current.
                  const active = item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to} end={item.end}>
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.to === '/fila' && pending > 0 && (
                        <SidebarMenuBadge className="bg-[var(--brand)] text-[var(--on-brand)]">
                          {pending}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] p-2.5 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-white">
              <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-[var(--brand)]' : 'bg-white/30')} />
              {online ? 'Conectado' : 'Offline'}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-white/25 text-white hover:bg-white/10"
              onClick={onLogout}
            >
              Sair
            </Button>
          </div>
          {quota && (
            <span className="text-[11px] text-white/50">
              Envios hoje: {quota.used}/{quota.cap}
            </span>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
