import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '@/lib/logger';

// Initialize Gemini client
let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient() {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Custom LLM endpoint for ElevenLabs Conversational AI
 * Follows OpenAI chat completions API format
 * Routes requests to Gemini via Vertex AI
 */
export async function POST(request: NextRequest) {
  try {
    const body: OpenAIRequest = await request.json();
    const { messages, stream = true, max_tokens = 1024, temperature = 0.7 } = body;

    logger.info({ messageCount: messages.length, stream }, '[ConvAI LLM] Request received');

    const client = getGeminiClient();
    if (!client) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract system prompt and conversation history
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Get the Gemini model
    const geminiModel = client.getGenerativeModel({
      model: 'gemini-2.0-flash-001',
      systemInstruction: systemMessage?.content || '',
    });

    // Convert messages to Gemini format
    const history = conversationMessages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Get the last user message
    const lastMessage = conversationMessages[conversationMessages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Start chat with history
    const chat = geminiModel.startChat({
      history,
      generationConfig: {
        maxOutputTokens: max_tokens,
        temperature,
      },
    });

    if (stream) {
      // Streaming response in OpenAI SSE format
      const encoder = new TextEncoder();
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            const result = await chat.sendMessageStream(lastMessage.content);

            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) {
                // OpenAI SSE format
                const sseData = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'gemini-2.0-flash-001',
                  choices: [{
                    index: 0,
                    delta: { content: text },
                    finish_reason: null,
                  }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseData)}\n\n`));
              }
            }

            // Send [DONE] marker
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            logger.error({ error }, '[ConvAI LLM] Streaming error');
            controller.error(error);
          }
        },
      });

      return new Response(streamResponse, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // Non-streaming response
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;
      const text = response.text() || '';

      return new Response(
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gemini-2.0-flash-001',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    logger.error({ error }, '[ConvAI LLM] Error');
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
