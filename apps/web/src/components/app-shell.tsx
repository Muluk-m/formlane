import { useI18n } from '@atoms-demo/i18n/react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@atoms-demo/ui/components/sidebar'
import { LocaleSwitcher } from '@atoms-demo/ui/composites/locale-switcher'
import { Logo, LogoMark } from '@atoms-demo/ui/composites/logo'
import { Add01Icon, Folder01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { projectsQuery } from '../features/projects/queries'

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const projects = useQuery(projectsQuery)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <SidebarProvider defaultOpen={!pathname.startsWith('/project/')}>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <div
            className="hidden group-data-[collapsible=icon]:block"
            role="img"
            aria-label={t('brand.name')}
          >
            <LogoMark />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === '/'}
                    render={<Link to="/" />}
                    tooltip={t('atoms.newProject')}
                  >
                    <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
                    <span>{t('atoms.newProject')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t('atoms.projects')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects.data?.projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={pathname === `/project/${project.id}`}
                      render={<Link to="/project/$id" params={{ id: project.id }} />}
                      tooltip={project.title}
                    >
                      <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.5} />
                      <span>{project.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <LocaleSwitcher />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm text-muted-foreground">{t('atoms.workspace')}</span>
        </div>
        <div
          className={`${pathname.startsWith('/project/') ? '' : 'landing-bg'} relative min-w-0 flex-1`}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
