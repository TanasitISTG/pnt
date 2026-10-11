import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Operator screens call the admin endpoints; the server checks the admin role on
  // every one of them, so this only adds the typed client methods.
  plugins: [adminClient()],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  changeEmail,
  deleteUser,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  revokeSessions,
  linkSocial,
  listAccounts,
  unlinkAccount,
} = authClient;
