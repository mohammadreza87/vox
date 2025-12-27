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

// Helper to create SSE response
function createSSEResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Helper to send SSE message
function formatSSE(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  // Check for authentication
  const token = extractBearerToken(request.headers.get('Authorization'));
  let userId: string | null = null;
  let tier: 'free' | 'pro' | 'max' = 'free';
  let messagesUsedToday = 0;

  if (token) {
    const decodedToken = await verifyIdToken(token);
    if (decodedToken) {
      userId = decodedToken.uid;

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
    return new Response(
      formatSSE({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        done: true,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  }

  const { message, systemPrompt, conversationHistory, aiProvider = 'deepseek', aiModel } = parseResult.data;
  const sanitizedMessage = sanitizeForAI(message);
  const modelToUse = aiModel || getDefaultModel(aiProvider);

  // Check daily message limit
  if (!canSendMessage(tier, messagesUsedToday)) {
    return new Response(
      formatSSE({
        error: 'Daily message limit reached',
        code: 'LIMIT_REACHED',
        limit: SUBSCRIPTION_TIERS[tier].features.dailyMessageLimit,
        used: messagesUsedToday,
        done: true,
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  }

  // Check model access
  if (!canUseModel(tier, modelToUse)) {
    return new Response(
      formatSSE({
        error: 'This model requires a Pro or Max subscription',
        code: 'MODEL_RESTRICTED',
        model: modelToUse,
        done: true,
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  }

  console.log(`[Stream] Using AI provider: ${aiProvider}, model: ${modelToUse}, tier: ${tier}`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        switch (aiProvider) {
          case 'openai':
            await streamOpenAI(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse
            );
            break;
          case 'deepseek':
            await streamDeepSeek(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse
            );
            break;
          case 'claude':
            await streamClaude(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse
            );
            break;
          case 'gemini':
          default:
            await streamGemini(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse
            );
            break;
        }

        // Increment message count after successful stream
        if (userId) {
          await incrementMessageCount(userId);
        }

        // Send done message
        controller.enqueue(encoder.encode(formatSSE({ done: true })));
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        controller.enqueue(
          encoder.encode(
            formatSSE({
              error: error instanceof Error ? error.message : 'Stream failed',
              done: true,
            })
          )
        );
        controller.close();
      }
    },
  });

  return createSSEResponse(stream);
}

// Streaming functions for each provider

async function streamOpenAI(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string
) {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI API key not configured');
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: message },
  ];

  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 1024,
    temperature: 0.7,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      controller.enqueue(encoder.encode(formatSSE({ content, done: false })));
    }
  }
}

async function streamDeepSeek(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string
) {
  const client = getDeepSeekClient();
  if (!client) {
    throw new Error('DeepSeek API key not configured');
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: message },
  ];

  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 1024,
    temperature: 0.7,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      controller.enqueue(encoder.encode(formatSSE({ content, done: false })));
    }
  }
}

async function streamClaude(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string
) {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error('Anthropic API key not configured');
  }

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

  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      controller.enqueue(encoder.encode(formatSSE({ content: event.delta.text, done: false })));
    }
  }
}

async function streamGemini(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string
) {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API key not configured');
  }

  const geminiModel = client.getGenerativeModel({
    model,
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

  const result = await chat.sendMessageStream(message);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      controller.enqueue(encoder.encode(formatSSE({ content: text, done: false })));
    }
  }
}
