import { getAdminDb } from '@/db/admin';
export default function Page() {
  return <div>{String(getAdminDb)}</div>;
}
