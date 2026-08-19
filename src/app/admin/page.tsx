import { getProfiles } from '@/app/actions/admin'
import { getDepartments } from '@/app/actions/campaigns'
import { getCurrentProfile } from '@/app/actions/auth'
import { AdminClient } from './AdminClient'

export default async function AdminPage() {
  const [profiles, departments, me] = await Promise.all([
    getProfiles(),
    getDepartments(),
    getCurrentProfile(),
  ])
  return (
    <AdminClient profiles={profiles} departments={departments} currentUserId={me?.id ?? null} />
  )
}
