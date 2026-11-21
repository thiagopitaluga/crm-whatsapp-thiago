import { redirect } from 'next/navigation';
import { PlatformAdminDashboard } from './platform-admin-dashboard';
import { requirePlatformAdmin } from '@/lib/platform-admin';

export const dynamic = 'force-dynamic';

export default async function PlatformAdminPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect('/dashboard');
  }
  return <PlatformAdminDashboard />;
}

