const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma2:2b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 300_000);

export class AiServiceError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
  }
}

/**
 * Sends a prompt to the local Ollama server and returns the raw text response.
 * Set expectJson to true to force Ollama's JSON mode (used by the explore route).
 */
export const askOllama = async (prompt: string, expectJson: boolean = false): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        ...(expectJson ? { format: 'json' } : {}),
        keep_alive: '30m', // keep the model in memory between requests
        options: {
          temperature: expectJson ? 0.2 : 0.6,
          // Hard cap so JSON mode can never run away generating forever
          num_predict: expectJson ? 800 : 350,
          repeat_penalty: 1.1,
        },
      }),
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new AiServiceError(`Ollama did not respond within ${TIMEOUT_MS / 1000}s`, 504);
    }
    throw new AiServiceError(`Cannot reach Ollama at ${OLLAMA_URL}. Is it running?`, 503);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiServiceError(`Ollama returned ${response.status}: ${detail.slice(0, 200)}`, 502);
  }

  const data: any = await response.json();
  if (typeof data?.response !== 'string' || !data.response.trim()) {
    throw new AiServiceError('Ollama returned an empty response', 502);
  }
  return data.response.trim();
};

/**
 * Loads the model into memory ahead of the first request.
 * Call once after the server starts; failures are logged, never thrown.
 */
export const warmUpModel = async (): Promise<void> => {
  try {
    await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: '30m' }),
    });
    console.log(`🔥 ${OLLAMA_MODEL} loaded and ready`);
  } catch {
    console.warn(`⚠️  Could not warm up ${OLLAMA_MODEL}. Is Ollama running?`);
  }
};

/**
 * Small models sometimes wrap JSON in code fences or add stray text.
 * This strips fences and parses the outermost {...} block.
 */
export const parseJsonLoose = (text: string): any => {
  const unfenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object found in AI output');
  return JSON.parse(unfenced.slice(start, end + 1));
};