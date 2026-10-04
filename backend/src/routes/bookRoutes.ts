import { Router } from 'express';
import { exploreBook, readBook } from '../controllers/bookController';

const router = Router();

// POST /api/book/explore  { title }                      -> { title, author, summary, chapters[] }
router.post('/explore', exploreBook);

// POST /api/book/read     { title, chapter, question }   -> { answer }
router.post('/read', readBook);

export default router;