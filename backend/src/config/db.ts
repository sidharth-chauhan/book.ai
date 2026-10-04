import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const MONGO_URI = 'mongodb://127.0.0.1:27017/book_reader';
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to Local MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};