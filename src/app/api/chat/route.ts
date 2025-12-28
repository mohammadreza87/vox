import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getUserDocument, incrementMessageCount, createUserDocument } from '@/lib/firestore';
import { SUBSCRIPTION_TIERS, canUseModel, canSendMessage } from '@/config/subscription';
import { chatRequestSchema } from '@/lib/validation/schemas';
import { sanitizeForAI } from '@/lib/validation/sanitize';
import { getChatRateLimiter, applyRateLimit } from '@/lib/ratelimit';
import { success, badRequest, forbidden, tooManyRequests, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { withTimeout, TIMEOUTS } from '@/lib/api/timeout';
import { withRetry } from '@/lib/retry';

// Initialize AI clients lazily
let geminiClient: GoogleGenerativeAI | null = null;
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

function getGeminiClient() {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
}

function getAnthropicClient() {
  if (!anthropicClient && process.env.ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function getOpenAIClient() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

function getDeepSeekClient() {
  if (!deepseekClient && process.env.DEEPSEEK_API_KEY) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com/v1',
    });
  }
  return deepseekClient;
}

export async function POST(request: NextRequest) {
  try {
    // Check for authentication (optional - allows anonymous users with free tier)
    const token = extractBearerToken(request.headers.get('Authorization'));
    let userId: string | null = null;
    let tier: 'free' | 'pro' | 'max' = 'free';
    let messagesUsedToday = 0;

    if (token) {
      const decodedToken = await verifyIdToken(token);
      if (decodedToken) {
        userId = decodedToken.uid;

        // Get or create user document
        let userDoc = await getUserDocument(userId);
        if (!userDoc && decodedToken.email) {
          await createUserDocument(userId, decodedToken.email, decodedToken.name || '');
          userDoc = await getUserDocument(userId);
        }

        if (userDoc) {
          tier = userDoc.subscription.tier;
          messagesUsedToday = userDoc.usage.messagesUsedToday;
        }
      }
    }

    // Apply rate limiting
    const rateLimitResponse = await applyRateLimit(request, getChatRateLimiter(), userId ?? undefined);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = chatRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return badRequest('Validation failed', {
        issues: parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { message, systemPrompt, conversationHistory, aiProvider = 'deepseek', aiModel } = parseResult.data;

    // Sanitize message for AI
    const sanitizedMessage = sanitizeForAI(message);

    // Check daily message limit
    const modelToUse = aiModel || getDefaultModel(aiProvider);
    if (!canSendMessage(tier, messagesUsedToday)) {
      return tooManyRequests('Daily message limit reached');
    }

    // Check model access
    if (!canUseModel(tier, modelToUse)) {
      return forbidden('This model requires a Pro or Max subscription');
    }

    logger.info({ aiProvider, model: modelToUse, tier }, 'Processing chat request');

    // Execute AI call with timeout and retry
    const responseText = await withRetry(
      async () => {
        return withTimeout(
          executeAIChat(aiProvider, sanitizedMessage, systemPrompt || '', conversationHistory, modelToUse),
          TIMEOUTS.CHAT,
          `${aiProvider} chat completion`
        );
      },
      { maxRetries: 2, baseDelay: 1000 }
    );

    // Increment message count for authenticated users
    if (userId) {
      await incrementMessageCount(userId);
    }

    return success({
      content: responseText,
      isMock: false,
      provider: aiProvider,
    });
  } catch (error) {
    logger.error({ error }, 'Chat API error');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Return mock response on error to maintain UX
    return success({
      content: getMockResponse('default', 'error'),
      isMock: true,
      error: errorMessage,
    });
  }
}

async function executeAIChat(
  aiProvider: string,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string
): Promise<string> {
  switch (aiProvider) {
    case 'claude':
      return handleClaudeChat(message, systemPrompt, conversationHistory, model);
    case 'openai':
      return handleOpenAIChat(message, systemPrompt, conversationHistory, model);
    case 'deepseek':
      return handleDeepSeekChat(message, systemPrompt, conversationHistory, model);
    case 'gemini':
    default:
      return handleGeminiChat(message, systemPrompt, conversationHistory, model);
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'claude-3-5-haiku-20241022';
    case 'openai':
      return 'gpt-4o-mini';
    case 'deepseek':
      return 'deepseek-chat';
    case 'gemini':
    default:
      return 'gemini-2.0-flash';
  }
}

async function handleGeminiChat(
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model?: string
): Promise<string> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API key not configured');
  }

  const modelName = model || 'gemini-2.0-flash';
  const geminiModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  // Filter out leading assistant messages
  let filteredHistory = [...conversationHistory];
  while (filteredHistory.length > 0 && filteredHistory[0].role === 'assistant') {
    filteredHistory.shift();
  }

  const history = filteredHistory.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  const chat = geminiModel.startChat({
    history,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  });

  const result = await chat.sendMessage(message);
  const response = await result.response;
  return response.text();
}

async function handleClaudeChat(
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model?: string
): Promise<string> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error('Anthropic API key not configured');
  }

  const modelName = model || 'claude-sonnet-4-20250514';

  // Filter out leading assistant messages
  let filteredHistory = [...conversationHistory];
  while (filteredHistory.length > 0 && filteredHistory[0].role === 'assistant') {
    filteredHistory.shift();
  }

  const messages = [
    ...filteredHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user' as const, content: message },
  ];

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const textContent = response.content.find((block) => block.type === 'text');
  return textContent?.type === 'text' ? textContent.text : '';
}

async function handleOpenAIChat(
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model?: string
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI API key not configured');
  }

  const modelName = model || 'gpt-4o-mini';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: message },
  ];

  const response = await client.chat.completions.create({
    model: modelName,
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || '';
}

async function handleDeepSeekChat(
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model?: string
): Promise<string> {
  const client = getDeepSeekClient();
  if (!client) {
    throw new Error('DeepSeek API key not configured');
  }

  const modelName = model || 'deepseek-chat';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: message },
  ];

  const response = await client.chat.completions.create({
    model: modelName,
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || '';
}

// Mock responses for when API is not configured
function getMockResponse(contactId: string, userMessage: string): string {
  const responses: Record<string, string[]> = {
    'alice-interview-coach': [
      "That's a great start! Let me give you some feedback. Your answer shows good self-awareness, but try to be more specific with examples.",
      "Good answer! I'd rate that about 7/10. To improve, try using the STAR method: Situation, Task, Action, Result.",
    ],
    'carlos-spanish-tutor': [
      "¡Muy bien! Tu pronunciación está mejorando. Let's practice another phrase.",
      "¡Perfecto! You're making great progress. Now let's try a short conversation.",
    ],
  };

  const contactResponses = responses[contactId] || [
    "That's an interesting point. Can you tell me more about what you're thinking?",
    "I understand. Let me help you work through this step by step.",
  ];

  return contactResponses[Math.floor(Math.random() * contactResponses.length)];
}
