/**
 * Memory Extraction API
 *
 * POST /api/memory/extract
 * Extracts facts, session summary, and continuation context from a conversation
 * using LLM analysis.
 */

import { VertexAI } from '@google-cloud/vertexai';
import { z } from 'zod';
import { ExtractMemoryResponse, MemoryExtractionResult } from '@/shared/types';
import {
  success,
  badRequest,
  serverError,
} from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { withTimeout, TIMEOUTS } from '@/lib/api/timeout';
import { withAuth, type AuthenticatedRequest } from '@/lib/middleware';

// Initialize Vertex AI client lazily
let vertexClient: VertexAI | null = null;

function getVertexClient() {
  if (!vertexClient && process.env.GOOGLE_CLOUD_PROJECT) {
    vertexClient = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });
  }
  return vertexClient;
}

// Request validation schema
const extractMemoryRequestSchema = z.object({
  contactId: z.string().min(1, 'contactId is required'),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'agent']),
    content: z.string(),
    timestamp: z.number().optional(),
  })).min(1, 'At least one message is required'),
  type: z.enum(['chat', 'call']),
  duration: z.number().optional(),
});

// Memory extraction prompt template
const EXTRACTION_PROMPT = `You are analyzing a conversation to extract memories for context engineering.

Analyze the following {type} conversation and extract:

1. FACTS: New facts learned about the user (preferences, skill levels, personal details, goals)
   - Each fact should have a unique key (snake_case)
   - Include a confidence score (0.0-1.0)
   - Only extract facts explicitly stated or strongly implied

2. SUMMARY: A 1-2 sentence summary of what was discussed

3. KEY_TOPICS: Array of main topics/themes (max 5)

4. LAST_TOPIC: The most recent topic being discussed (for continuation)

5. NEXT_STEPS: What was planned or suggested for next time (if any)

6. USER_MOOD: The user's apparent mood/sentiment (optional)

CONVERSATION:
{transcript}

Respond ONLY with valid JSON in this exact format:
{
  "facts": [
    {"key": "fact_key", "value": "fact description", "confidence": 0.9}
  ],
  "summary": "Brief summary of the conversation",
  "keyTopics": ["topic1", "topic2"],
  "lastTopic": "Most recent discussion topic",
  "nextSteps": "What to continue with next time (or null)",
  "userMood": "User's mood (or null)"
}

Important:
- Extract only meaningful, reusable facts (not transient conversation details)
- Use clear, descriptive keys like "user_name", "learning_goal", "skill_level"
- Be conservative with confidence scores
- If no clear facts can be extracted, return an empty facts array`;

export const POST = withAuth(async (request: AuthenticatedRequest, _context) => {
  try {
    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = extractMemoryRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return badRequest('Validation failed', {
        issues: parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { contactId, messages, type, duration } = parseResult.data;

    logger.info({ contactId, type, messageCount: messages.length }, 'Extracting memories from conversation');

    // Build transcript from messages
    const transcript = messages
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n');

    // Prepare prompt
    const prompt = EXTRACTION_PROMPT
      .replace('{type}', type)
      .replace('{transcript}', transcript);

    // Call LLM for extraction
    const extraction = await withTimeout(
      extractWithLLM(prompt),
      TIMEOUTS.CHAT,
      'Memory extraction'
    );

    // Format response
    const response: ExtractMemoryResponse = {
      facts: extraction.facts.map((f) => ({
        key: f.key,
        value: f.value,
        source: type,
        confidence: f.confidence,
      })),
      session: {
        type,
        duration,
        messageCount: messages.length,
        summary: extraction.summary,
        keyTopics: extraction.keyTopics,
        userMood: extraction.userMood,
      },
      lastInteraction: {
        type,
        lastTopic: extraction.lastTopic,
        nextSteps: extraction.nextSteps,
      },
    };

    logger.info(
      { contactId, factsExtracted: response.facts.length, topics: response.session.keyTopics },
      'Memory extraction complete'
    );

    return success(response);
  } catch (error) {
    logger.error({ error }, 'Memory extraction failed');
    return serverError(
      error instanceof Error ? error.message : 'Memory extraction failed'
    );
  }
});

async function extractWithLLM(prompt: string): Promise<MemoryExtractionResult> {
  const client = getVertexClient();
  if (!client) {
    throw new Error('Google Cloud Project not configured for Vertex AI');
  }

  const model = client.getGenerativeModel({
    model: 'gemini-2.0-flash-001',
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.3, // Lower temperature for more consistent JSON output
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No response from LLM');
  }

  // Parse JSON response
  try {
    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    }
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    const parsed = JSON.parse(jsonText) as MemoryExtractionResult;

    // Validate structure
    if (!Array.isArray(parsed.facts)) {
      parsed.facts = [];
    }
    if (!parsed.summary) {
      parsed.summary = 'Conversation summary unavailable';
    }
    if (!Array.isArray(parsed.keyTopics)) {
      parsed.keyTopics = [];
    }
    if (!parsed.lastTopic) {
      parsed.lastTopic = parsed.keyTopics[0] || 'General conversation';
    }

    return parsed;
  } catch (parseError) {
    logger.error({ text, parseError }, 'Failed to parse LLM response as JSON');
    // Return a safe default
    return {
      facts: [],
      summary: 'Conversation occurred',
      keyTopics: [],
      lastTopic: 'General conversation',
      nextSteps: undefined,
      userMood: undefined,
    };
  }
}
