import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { signOut } from "@/lib/auth/auth-client";

/**
 * Signing out clears every cached read before the shell re-renders for a guest. Both the
 * header menu and the drawer use this hook, so the two paths cannot drift.
 */
export function useSignOut() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    setSigningOut(true);
    void signOut({
      fetchOptions: {
        onSuccess: () => {
          queryClient.clear();
          router.invalidate().finally(() => navigate({ to: "/" }));
        },
        onError: () => {
          setSigningOut(false);
        },
      },
    });
  };

  return { signingOut, signOut: handleSignOut };
}
