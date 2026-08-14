import type { ContentModuleKey } from '@panshi/contracts'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { AdminClient } from '../api/admin-client'
import { AdminLayout } from '../layout/AdminLayout'
import { DashboardPage } from '../pages/DashboardPage'
import { ContentPage, ResourcesPlaceholderPage } from '../pages/content/ContentPage'

const modules: ContentModuleKey[] = ['basic', 'features', 'organizations', 'importantDates', 'schedule', 'travel', 'contacts', 'display']

export function AdminApp({ client, publicWebBaseUrl, displayName = '管理员', onLogout }: { client: AdminClient, publicWebBaseUrl: string, displayName?: string, onLogout?: () => Promise<void> }) {
  return <AdminLayout displayName={displayName} onLogout={onLogout}><Routes><Route path="/" element={<DashboardPage client={client} />} />
    {modules.map((key) => <Route key={key} path={`/content/${key}`} element={<ContentPage moduleKey={key} client={client} publicWebBaseUrl={publicWebBaseUrl} />} />)}
    <Route path="/content/resources" element={<ResourcesPlaceholderPage />} /><Route path="*" element={<Navigate replace to="/" />} /></Routes></AdminLayout>
}
