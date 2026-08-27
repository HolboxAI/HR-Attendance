import { Suspense } from 'react';

import { AuthPage } from '@/components/ui/auth-page';

export default function LoginPage() {
  // useSearchParams (for ?next=) needs a Suspense boundary to keep the route
  // static-safe.
  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}
