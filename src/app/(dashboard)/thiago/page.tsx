import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlatformAdminDashboard } from './platform-admin-dashboard';
import { requirePlatformAdmin } from '@/lib/platform-admin';

export const dynamic = 'force-dynamic';

export default async function PlatformAdminPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect('/dashboard');
  }
  return (
    <div className="space-y-4">
      <Link href="/thiago/assinaturas" className="hover:bg-muted inline-flex rounded-md border px-3 py-2 text-sm font-medium">
        Gerenciar assinaturas
      </Link>
      <PlatformAdminDashboard />
    </div>
  );
}

