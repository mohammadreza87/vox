'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.contactId as string;

  useEffect(() => {
    // Redirect to app page - the contact will be selected there
    router.replace(`/app?contact=${contactId}`);
  }, [router, contactId]);

  return null;
}
