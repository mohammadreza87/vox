import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

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

interface ChatRequest {
  message: string;
  contactId: string;
  systemPrompt: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  aiProvider?: 'gemini' | 'claude' | 'openai' | 'deepseek';
  aiModel?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, systemPrompt, conversationHistory, aiProvider = 'gemini', aiModel } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    console.log(`Using AI provider: ${aiProvider}, model: ${aiModel || 'default'}`);

    let responseText: string;

    switch (aiProvider) {
      case 'claude':
        responseText = await handleClaudeChat(message, systemPrompt, conversationHistory, aiModel);
        break;
      case 'openai':
        responseText = await handleOpenAIChat(message, systemPrompt, conversationHistory, aiModel);
        break;
      case 'deepseek':
        responseText = await handleDeepSeekChat(message, systemPrompt, conversationHistory, aiModel);
        break;
      case 'gemini':
      default:
        responseText = await handleGeminiChat(message, systemPrompt, conversationHistory, aiModel);
        break;
    }

    return NextResponse.json({
      content: responseText,
      isMock: false,
      provider: aiProvider,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json({
      content: getMockResponse('default', 'error'),
      isMock: true,
      error: errorMessage,
    });
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
