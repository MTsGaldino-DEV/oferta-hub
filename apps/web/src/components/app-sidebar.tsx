import { Fragment } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Search,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { Logo } from './Logo.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar.js';

type NavItem = { to: string; label: string; end?: boolean; icon: LucideIcon };

// Blocos separados por linha divisoria (sem rotulo de texto). Ordem e itens
// identicos aos de antes -- so a forma de agrupar visualmente mudou.
const GROUPS: NavItem[][] = [
  [
    { to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard },
    { to: '/fila', label: 'Fila', icon: ListChecks },
  ],
  [
    { to: '/garimpar', label: 'Garimpar', icon: Search },
    { to: '/automacoes', label: 'Automações', icon: Workflow },
  ],
  [
    { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
    { to: '/grupos', label: 'Meus Grupos', icon: Users },
  ],
];

const CONFIG_ITEM: NavItem = { to: '/configuracoes', label: 'Configurações', icon: Settings };

function Divider() {
  return <div className="mx-3 border-t border-white/10" aria-hidden="true" />;
}

interface AppSidebarProps {
  pending: number;
  online: boolean;
  quota: { used: number; cap: number } | null;
  onLogout: () => void;
}

export function AppSidebar({ pending, online, quota, onLogout }: AppSidebarProps) {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  function renderGroup(items: NavItem[], key: string) {
    return (
      <SidebarGroup key={key}>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
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
                    <NavLink to={item.to} end={item.end} onClick={() => setOpenMobile(false)}>
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
    );
  }

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

      <SidebarContent role="navigation" aria-label="Navegação principal">
        {GROUPS.map((items, gi) => (
          <Fragment key={gi}>
            <Divider />
            {renderGroup(items, `g${gi}`)}
          </Fragment>
        ))}
        {/* Empurra o bloco de Configuracoes pro rodape da area de navegacao,
            deixando o vazio grande do meio como na referencia. */}
        <div className="flex-1" />
        <Divider />
        {renderGroup([CONFIG_ITEM], 'config')}
      </SidebarContent>

      <SidebarFooter>
        {quota && (
          <span className="px-1.5 text-[11px] text-white/50 group-data-[collapsible=icon]:hidden">
            Envios hoje: {quota.used}/{quota.cap}
          </span>
        )}
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:justify-center">
          {/* Nome e plano estaticos: painel e de senha unica, sem usuario no
              banco ainda -- mesmos valores que a aba Conta mostra hoje.
              Vira dinamico quando o produto virar multiusuario. */}
          <NavLink
            to="/configuracoes"
            onClick={() => setOpenMobile(false)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 hover:bg-sidebar-accent group-data-[collapsible=icon]:flex-none"
          >
            <span className="relative shrink-0">
              <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                MC
              </span>
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-sidebar',
                  online ? 'bg-[var(--brand)]' : 'bg-white/30',
                )}
                title={online ? 'Conectado' : 'Offline'}
                aria-label={online ? 'Conectado' : 'Offline'}
              />
            </span>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-sm font-semibold text-white">Minha conta</span>
              <span className="block truncate text-xs text-white/50">Instalação própria</span>
            </span>
          </NavLink>
          <button
            type="button"
            aria-label="Sair"
            onClick={onLogout}
            className="shrink-0 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white group-data-[collapsible=icon]:hidden"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
