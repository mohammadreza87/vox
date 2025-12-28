import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { createSessionToken } from '@/lib/auth/jwt';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

interface TelegramAuthData {
  query_id?: string;
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  auth_date: number;
  hash: string;
}

// Telegram Login Widget user data
interface TelegramLoginWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Validate Telegram Mini App init data
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateMiniAppData(initData: string): TelegramAuthData | null {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) {
      console.error('No hash in init data');
      return null;
    }

    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Mini App uses different secret key derivation
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      console.error('Hash mismatch');
      return null;
    }

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      console.error('Auth data expired');
      return null;
    }

    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) : undefined;

    return {
      query_id: params.get('query_id') || undefined,
      user,
      auth_date: authDate,
      hash,
    };
  } catch (error) {
    console.error('Error validating Mini App data:', error);
    return null;
  }
}

/**
 * Validate Telegram Login Widget data
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function validateLoginWidgetData(user: TelegramLoginWidgetUser): boolean {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return false;
  }

  try {
    const { hash, ...userData } = user;

    // Check auth date (valid for 24 hours)
    const now = Math.floor(Date.now() / 1000);
    if (now - userData.auth_date > 86400) {
      console.error('Login widget auth data expired');
      return false;
    }

    // Create data check string
    const dataCheckString = Object.entries(userData)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Login Widget uses SHA256 of token as secret key
    const secretKey = crypto
      .createHash('sha256')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      console.error('Login widget hash mismatch');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error validating Login Widget data:', error);
    return false;
  }
}

/**
 * Create or update user in Firestore
 * Note: We skip Firebase custom tokens due to IAM complexity in Cloud Run
 * Instead, we use Telegram's own authentication
 */
async function handleTelegramUser(
  telegramId: number,
  userData: {
    firstName: string;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
    languageCode?: string | null;
    isPremium?: boolean;
  },
  source: 'miniapp' | 'widget'
) {
  const telegramUserId = `telegram_${telegramId}`;
  const adminDb = await getAdminDb();
  const userRef = adminDb.collection('users').doc(telegramUserId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    // Create new user
    await userRef.set({
      telegramId,
      firstName: userData.firstName,
      lastName: userData.lastName || null,
      username: userData.username || null,
      photoUrl: userData.photoUrl || null,
      languageCode: userData.languageCode || null,
      isPremium: userData.isPremium || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      authSource: source,
    });

    // Initialize default user data
    await userRef.collection('data').doc('settings').set({
      theme: 'system',
      language: userData.languageCode || 'en',
    });

    // Initialize subscription as free tier
    await userRef.collection('data').doc('subscription').set({
      tier: 'free',
      messagesUsed: 0,
      voiceClonesUsed: 0,
      customContactsUsed: 0,
    });
  } else {
    // Update existing user
    await userRef.update({
      firstName: userData.firstName,
      lastName: userData.lastName || null,
      username: userData.username || null,
      photoUrl: userData.photoUrl || null,
      isPremium: userData.isPremium || false,
      updatedAt: new Date().toISOString(),
      lastAuthSource: source,
    });
  }

  // Generate a signed JWT session token
  const sessionToken = await createSessionToken({
    userId: telegramUserId,
    telegramId,
    platform: source === 'miniapp' ? 'telegram_miniapp' : 'telegram_widget',
    expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  return {
    userId: telegramUserId,
    isNewUser: !userDoc.exists,
    sessionToken,
  };
}

/**
 * POST /api/auth/telegram
 * Authenticate user from Telegram (Mini App or Login Widget)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if this is Mini App auth (initData) or Login Widget auth (user object)
    if (body.initData) {
      // Mini App authentication
      const authData = validateMiniAppData(body.initData);

      if (!authData || !authData.user) {
        return NextResponse.json(
          { error: 'Invalid or expired Telegram Mini App data' },
          { status: 401 }
        );
      }

      const result = await handleTelegramUser(
        authData.user.id,
        {
          firstName: authData.user.first_name,
          lastName: authData.user.last_name,
          username: authData.user.username,
          languageCode: authData.user.language_code,
          isPremium: authData.user.is_premium,
        },
        'miniapp'
      );

      return NextResponse.json({
        success: true,
        user: {
          id: result.userId,
          telegramId: authData.user.id,
          firstName: authData.user.first_name,
          lastName: authData.user.last_name,
          username: authData.user.username,
          isPremium: authData.user.is_premium,
        },
        isNewUser: result.isNewUser,
        sessionToken: result.sessionToken,
        source: 'miniapp',
      });
    } else if (body.user) {
      // Login Widget authentication
      const user = body.user as TelegramLoginWidgetUser;

      if (!validateLoginWidgetData(user)) {
        return NextResponse.json(
          { error: 'Invalid or expired Telegram login data' },
          { status: 401 }
        );
      }

      const result = await handleTelegramUser(
        user.id,
        {
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          photoUrl: user.photo_url,
        },
        'widget'
      );

      return NextResponse.json({
        success: true,
        user: {
          id: result.userId,
          telegramId: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          photoUrl: user.photo_url,
        },
        isNewUser: result.isNewUser,
        sessionToken: result.sessionToken,
        source: 'widget',
      });
    } else {
      return NextResponse.json(
        { error: 'Missing initData or user object' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Telegram auth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/telegram
 * Check if Telegram auth is enabled
 */
export async function GET() {
  return NextResponse.json({
    enabled: Boolean(TELEGRAM_BOT_TOKEN),
    botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || null,
  });
}
