import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db';
import bookRoutes from './routes/bookRoutes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect Database
connectDB();

// Mount Routes
app.use('/api/book', bookRoutes);

// Start Server
app.listen(5001, () => {
  console.log('🚀 Backend running at http://localhost:5001');
});