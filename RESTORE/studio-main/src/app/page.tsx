
'use client';

import { ChatLayout } from '@/components/chat-layout';
import { useAuth } from '@/hooks/use-auth';

export default function Home() {
  const { user } = useAuth();

  if (!user) {
    // AuthProvider will handle redirection, this is a fallback.
    return null;
  }
  
  return <ChatLayout />;
}
