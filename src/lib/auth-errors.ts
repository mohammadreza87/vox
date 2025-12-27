/**
 * Firebase Auth Error Messages
 * Converts Firebase error codes to user-friendly messages
 */

const authErrorMessages: Record<string, string> = {
  // Sign In Errors
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/user-not-found': 'No account found with this email. Would you like to sign up?',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/invalid-credential': 'Invalid email or password. Please check and try again.',
  'auth/invalid-login-credentials': 'Invalid email or password. Please check and try again.',

  // Sign Up Errors
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled. Please contact support.',
  'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',

  // Google Sign In Errors
  'auth/popup-closed-by-user': 'Sign-in was cancelled. Please try again.',
  'auth/popup-blocked': 'Pop-up was blocked by your browser. Please allow pop-ups and try again.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled. Please try again.',
  'auth/unauthorized-domain': 'This domain is not authorized for sign-in. Please contact support.',
  'auth/account-exists-with-different-credential': 'An account already exists with this email but with a different sign-in method.',

  // Network Errors
  'auth/network-request-failed': 'Network error. Please check your internet connection and try again.',
  'auth/too-many-requests': 'Too many failed attempts. Please wait a few minutes and try again.',
  'auth/timeout': 'The request timed out. Please try again.',

  // Session Errors
  'auth/requires-recent-login': 'Please sign in again to complete this action.',
  'auth/session-expired': 'Your session has expired. Please sign in again.',

  // Generic
  'auth/internal-error': 'An unexpected error occurred. Please try again.',
};

/**
 * Get user-friendly error message from Firebase error
 */
export function getAuthErrorMessage(error: unknown): string {
  // Handle Firebase error object
  if (error && typeof error === 'object') {
    const firebaseError = error as { code?: string; message?: string };

    // Check if we have a friendly message for this error code
    if (firebaseError.code && authErrorMessages[firebaseError.code]) {
      return authErrorMessages[firebaseError.code];
    }

    // Try to extract error code from message (Firebase sometimes embeds it)
    if (firebaseError.message) {
      const codeMatch = firebaseError.message.match(/\(auth\/[^)]+\)/);
      if (codeMatch) {
        const code = codeMatch[0].replace('(', '').replace(')', '');
        if (authErrorMessages[code]) {
          return authErrorMessages[code];
        }
      }

      // Clean up the Firebase message
      return firebaseError.message
        .replace('Firebase: ', '')
        .replace(/\(auth\/[^)]+\)\.?/, '')
        .trim() || 'An error occurred. Please try again.';
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error;
  }

  // Handle Error objects
  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Check if error is a specific auth error
 */
export function isAuthError(error: unknown, code: string): boolean {
  if (error && typeof error === 'object') {
    const firebaseError = error as { code?: string };
    return firebaseError.code === code;
  }
  return false;
}
