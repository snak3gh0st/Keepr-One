import 'server-only'

/**
 * Explicit preview for disposable local data only. This enables Better Auth's
 * unverified-email shortcut for the entire development process, so it must
 * never be enabled in staging or production. The Settings Server Action still
 * reauthenticates with the current password before requesting the change.
 */
export function allowLocalEmailChangeWithoutVerification(): boolean {
  return process.env.NODE_ENV === 'development'
    && process.env.ALLOW_LOCAL_EMAIL_CHANGE_WITHOUT_VERIFICATION === 'true'
}
