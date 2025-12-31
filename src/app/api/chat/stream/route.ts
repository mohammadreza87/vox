import { VertexAI } from '@google-cloud/vertexai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getUserDocument, incrementMessageCount, createUserDocument } from '@/lib/firestore';
import { SUBSCRIPTION_TIERS, canUseModel, canSendMessage } from '@/config/subscription';
import { chatRequestSchema } from '@/lib/validation/schemas';
import { sanitizeForAI } from '@/lib/validation/sanitize';
import {
  getChatRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';
import { withAuth, type AuthenticatedRequest } from '@/lib/middleware';
import {
  createLLMSpan,
  scanInput,
  scanOutput,
  isLLMObservabilityEnabled,
  type LLMSpan,
} from '@/lib/datadog';

// Initialize AI clients lazily
let vertexClient: VertexAI | null = null;
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

function getVertexClient() {
  if (!vertexClient && process.env.GOOGLE_CLOUD_PROJECT) {
    vertexClient = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });
  }
  return vertexClient;
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
      return 'gemini-2.0-flash-001';
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

export const POST = withAuth(async (request: AuthenticatedRequest, _context) => {
  const userId = request.userId;
  const rateResult = await checkRateLimitSecure(
    getChatRateLimiter(),
    getRateLimitIdentifier(request, userId),
    60, // Increased from 20 to allow for normal usage
    60_000
  );
  if (!rateResult.success && rateResult.response) {
    return rateResult.response;
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

  const { message, systemPrompt, conversationHistory, aiProvider = 'gemini', aiModel } = parseResult.data;
  const sanitizedMessage = sanitizeForAI(message);
  const modelToUse = aiModel || getDefaultModel(aiProvider);

  let userDoc = await getUserDocument(userId);
  if (!userDoc && request.user.email) {
    await createUserDocument(userId, request.user.email, request.user.name || '');
    userDoc = await getUserDocument(userId);
  }
  const tier = userDoc?.subscription.tier ?? 'free';
  const messagesUsedToday = userDoc?.usage.messagesUsedToday ?? 0;

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

  // Initialize Datadog LLM observability span
  const llmSpan = isLLMObservabilityEnabled()
    ? createLLMSpan('chat.stream', aiProvider as 'gemini' | 'claude' | 'openai' | 'deepseek', modelToUse, {
        userId,
        conversationTurn: conversationHistory.length + 1,
        temperature: 0.7,
        maxTokens: 1024,
      })
    : null;

  // Set input for token estimation
  if (llmSpan) {
    llmSpan.setInput(sanitizedMessage, systemPrompt || '');
    llmSpan.addEvent('request_started', { tier, messagesUsedToday });
  }

  // Security scan on input (async, non-blocking in production)
  const securityScanPromise = isLLMObservabilityEnabled()
    ? scanInput(sanitizedMessage, { userId, requestId: llmSpan?.getTraceId() })
    : Promise.resolve({ safe: true, threats: [], riskScore: 0, scanDurationMs: 0 });

  const encoder = new TextEncoder();
  let fullResponse = ''; // Collect full response for output scanning

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Check security scan result
        const securityResult = await securityScanPromise;
        if (!securityResult.safe && securityResult.riskScore > 70) {
          llmSpan?.addEvent('security_blocked', { riskScore: securityResult.riskScore });
          llmSpan?.recordError('Request blocked due to security concerns');
          await llmSpan?.finish();

          controller.enqueue(
            encoder.encode(
              formatSSE({
                error: 'Request blocked due to security concerns',
                code: 'SECURITY_BLOCKED',
                done: true,
              })
            )
          );
          controller.close();
          return;
        }

        switch (aiProvider) {
          case 'openai':
            fullResponse = await streamOpenAI(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse,
              llmSpan
            );
            break;
          case 'deepseek':
            fullResponse = await streamDeepSeek(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse,
              llmSpan
            );
            break;
          case 'claude':
            fullResponse = await streamClaude(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse,
              llmSpan
            );
            break;
          case 'gemini':
          default:
            fullResponse = await streamGemini(
              controller,
              encoder,
              sanitizedMessage,
              systemPrompt || '',
              conversationHistory,
              modelToUse,
              llmSpan
            );
            break;
        }

        // Set output for token estimation and finish span
        if (llmSpan) {
          llmSpan.setOutput(fullResponse);
          llmSpan.addEvent('stream_completed', { responseLength: fullResponse.length });
        }

        // Scan output for security issues (async)
        if (isLLMObservabilityEnabled()) {
          scanOutput(fullResponse, { userId, requestId: llmSpan?.getTraceId() }).catch(console.error);
        }

        // Increment message count after successful stream
        await incrementMessageCount(userId);

        // Finish the LLM span
        await llmSpan?.finish();

        // Send done message
        controller.enqueue(encoder.encode(formatSSE({ done: true })));
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);

        // Record error in span
        if (llmSpan) {
          llmSpan.recordError(error instanceof Error ? error : new Error(String(error)));
          await llmSpan.finish();
        }

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
});

// Streaming functions for each provider

async function streamOpenAI(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  llmSpan: LLMSpan | null
): Promise<string> {
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

  let fullResponse = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      llmSpan?.recordStreamedToken();
      controller.enqueue(encoder.encode(formatSSE({ content, done: false })));
    }
  }

  return fullResponse;
}

async function streamDeepSeek(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  llmSpan: LLMSpan | null
): Promise<string> {
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

  let fullResponse = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      llmSpan?.recordStreamedToken();
      controller.enqueue(encoder.encode(formatSSE({ content, done: false })));
    }
  }

  return fullResponse;
}

async function streamClaude(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  llmSpan: LLMSpan | null
): Promise<string> {
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

  let fullResponse = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullResponse += event.delta.text;
      llmSpan?.recordStreamedToken();
      controller.enqueue(encoder.encode(formatSSE({ content: event.delta.text, done: false })));
    }
  }

  return fullResponse;
}

async function streamGemini(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  message: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  llmSpan: LLMSpan | null
): Promise<string> {
  const client = getVertexClient();
  if (!client) {
    throw new Error('Google Cloud Project not configured for Vertex AI');
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

  let fullResponse = '';
  for await (const chunk of result.stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      fullResponse += text;
      llmSpan?.recordStreamedToken();
      controller.enqueue(encoder.encode(formatSSE({ content: text, done: false })));
    }
  }

  return fullResponse;
}
