import { signOut } from '@workos-inc/authkit-nextjs';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  // Sign out the user and redirect to home page
  return signOut({
    returnTo: '/',
  });
}