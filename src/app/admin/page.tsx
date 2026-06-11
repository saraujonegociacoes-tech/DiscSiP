import { getProfiles } from '@/app/actions/admin'
import { getDepartments } from '@/app/actions/campaigns'
import { AdminClient } from './AdminClient'

export default async function AdminPage() {
  const [profiles, departments] = await Promise.all([getProfiles(), getDepartments()])
  return <AdminClient profiles={profiles} departments={departments} />
}
