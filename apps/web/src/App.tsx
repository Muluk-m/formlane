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
import { PublishedPage } from './pages/PublishedPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: Missing,
  errorComponent: Missing,
})
async function loadOwner() {
  await ensureOwner()
}
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: loadOwner,
  component: () => (
    <AppShell>
      <HomePage />
    </AppShell>
  ),
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$id',
  beforeLoad: loadOwner,
  validateSearch: (search: Record<string, unknown>): { autostart?: boolean } => ({
    autostart: search.autostart === true || search.autostart === 'true' ? true : undefined,
  }),
  component: ProjectRoute,
})
const publishedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug',
  component: PublishedRoute,
})
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, projectRoute, publishedRoute]),
  defaultPreload: 'intent',
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
function ProjectRoute() {
  const { id } = useParams({ from: '/project/$id' })
  return (
    <AppShell>
      <ProjectPage key={id} />
    </AppShell>
  )
}
function PublishedRoute() {
  const { slug } = useParams({ from: '/p/$slug' })
  return <PublishedPage key={slug} slug={slug} />
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
