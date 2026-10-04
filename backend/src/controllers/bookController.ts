import { Request, Response } from 'express';
import { Book } from '../models/Book';
import { AiServiceError, askOllama, parseJsonLoose } from '../services/aiService';
import { getExplorePrompt, getReadPrompt } from '../utils/prompts';

const MAX_GENERATION_ATTEMPTS = 2;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

type Chapter = { title: string; summary: string };
type BookPayload = { title: string; author: string; summary: string; chapters: Chapter[] };

/** Validates and cleans whatever the model produced into the exact contract shape. */
const normalizeBook = (raw: any, fallbackTitle: string): BookPayload => {
  const chapters: Chapter[] = (Array.isArray(raw?.chapters) ? raw.chapters : [])
    .map((c: any) => ({ title: str(c?.title), summary: str(c?.summary) }))
    .filter((c: Chapter) => c.title);

  if (chapters.length === 0) throw new Error('AI response contained no chapters');

  return {
    title: str(raw?.title) || fallbackTitle,
    author: str(raw?.author) || 'Unknown author',
    summary: str(raw?.summary),
    chapters,
  };
};

/** Strips Mongo internals (_id, __v, chapter _ids) so the output matches the contract exactly. */
const toResponse = (book: any): BookPayload => ({
  title: book.title,
  author: book.author ?? '',
  summary: book.summary ?? '',
  chapters: (book.chapters ?? []).map((c: any) => ({ title: c.title ?? '', summary: c.summary ?? '' })),
});

const generateBook = async (title: string): Promise<BookPayload> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    try {
      const raw = await askOllama(getExplorePrompt(title), true);
      return normalizeBook(parseJsonLoose(raw), title);
    } catch (err) {
      // Connection problems won't fix themselves on retry
      if (err instanceof AiServiceError) throw err;
      lastError = err;
      console.warn(`Explore attempt ${attempt} returned unusable JSON:`, (err as Error).message);
    }
  }
  throw new AiServiceError(`Could not generate a valid book overview: ${(lastError as Error)?.message}`, 502);
};

const sendError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof AiServiceError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: fallback });
};

export const exploreBook = async (req: Request, res: Response) => {
  try {
    const title = str(req.body?.title);
    if (!title) return res.status(400).json({ error: 'Book title is required' });
    if (title.length > 200) return res.status(400).json({ error: 'Book title is too long' });

    // 1. Cache lookup (schema lowercases titles)
    const cached = await Book.findOne({ title: title.toLowerCase() });
    if (cached) {
      console.log('Serving from DB cache');
      return res.json(toResponse(cached));
    }

    // 2. Generate with the local model
    console.log('Asking local AI...');
    const generated = await generateBook(title);

    // The model may return a canonical title that is already cached under a different search
    const existing = await Book.findOne({ title: generated.title.toLowerCase() });
    if (existing) return res.json(toResponse(existing));

    // 3. Save and return
    try {
      const saved = await new Book(generated).save();
      return res.json(toResponse(saved));
    } catch (err: any) {
      // Two simultaneous requests for the same book: serve whichever saved first
      if (err?.code === 11000) {
        const winner = await Book.findOne({ title: generated.title.toLowerCase() });
        if (winner) return res.json(toResponse(winner));
      }
      throw err;
    }
  } catch (error) {
    console.error('Explore Error:', error);
    return sendError(res, error, 'Failed to explore book');
  }
};

export const readBook = async (req: Request, res: Response) => {
  try {
    const title = str(req.body?.title);
    const chapter = str(req.body?.chapter);
    const question = str(req.body?.question);

    if (!title || !chapter || !question) {
      return res.status(400).json({ error: 'title, chapter, and question are required' });
    }

    const prompt = getReadPrompt(title, chapter, question);
    const answer = await askOllama(prompt, false);

    // The frontend reads `answer`
    return res.json({ answer });
  } catch (error) {
    console.error('Read Error:', error);
    return sendError(res, error, 'Failed to chat with AI');
  }
};

export const generateAudio = async (req: Request, res: Response) => {
  try {
    const text = str(req.body?.text);
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY || '',
      },
      body: JSON.stringify({
        text: text.replace(/[*#`_]/g, ''),
        model_id: 'eleven_multilingual_v2',
      }),
    });

    if (!response.ok) {
      const errDetail = await response.text();
      console.error('ElevenLabs Rejected Request:', response.status, errDetail);
      throw new Error('ElevenLabs API error');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error) {
    console.error('Audio Error:', error);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
};