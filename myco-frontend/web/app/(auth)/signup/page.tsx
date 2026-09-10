import { Suspense } from 'react';
import { SignupPage } from '@/components/ui/signup-page';

export const metadata = {
  title: 'Request to Join | Holbox Workforce',
  description: 'Self-service employee registration for Holbox Workforce Attendance & Portal.',
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignupPage />
    </Suspense>
  );
}
