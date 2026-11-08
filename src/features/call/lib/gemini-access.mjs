export function canUseGeminiLive(user) {
  if (user.email_verified !== true) return false;
  const allowed = (process.env.VOX_GEMINI_LIVE_EMAILS ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
  return user.voxGeminiLive === true || allowed.includes(user.email?.toLowerCase());
}
