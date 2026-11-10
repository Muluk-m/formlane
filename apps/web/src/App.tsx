import { I18nProvider } from '@atoms-demo/i18n/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router'
import { AppShell } from './components/app-shell'
import { ensureOwner } from './lib/api'
import { HomePage } from './pages/HomePage'
import { Missing } from './pages/Missing'
import { ProjectPage } from './pages/ProjectPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})
const rootRoute = createRootRoute({
  beforeLoad: async () => {
    await ensureOwner()
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: Missing,
  errorComponent: Missing,
})
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$id',
  validateSearch: (search: Record<string, unknown>): { autostart?: boolean } => ({
    autostart: search.autostart === true || search.autostart === 'true' ? true : undefined,
  }),
  component: ProjectRoute,
})
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, projectRoute]),
  defaultPreload: 'intent',
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
function ProjectRoute() {
  const { id } = useParams({ from: '/project/$id' })
  return <ProjectPage key={id} />
}

export function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  )
}
