import { Router } from 'express';
import { exploreBook, readBook, generateAudio } from '../controllers/bookController';

const router = Router();

// POST /api/book/explore  { title }                      -> { title, author, summary, chapters[] }
router.post('/explore', exploreBook);

// POST /api/book/read     { title, chapter, question }   -> { answer }
router.post('/read', readBook);

// POST /api/book/tts      { text }                       -> audio/mpeg buffer
router.post('/tts', generateAudio);

export default router;