import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema({
  title: String,
  summary: String
});

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true, lowercase: true },
  author: String,
  summary: String,
  chapters: [chapterSchema]
});

export const Book = mongoose.model('Book', bookSchema);