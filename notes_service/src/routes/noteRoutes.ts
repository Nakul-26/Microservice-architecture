import express from 'express';
import mongoose from 'mongoose';
import Note from '../models/Note.js';

const router = express.Router();
type UserRole = 'admin' | 'user';

const getRequester = (req: express.Request) => {
  const requesterId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : '';
  const requesterRole = req.headers['x-user-role'] === 'admin' ? 'admin' : 'user';
  return { requesterId, requesterRole: requesterRole as UserRole };
};

router.get('/', async (req, res) => {
  const { requesterId, requesterRole } = getRequester(req);
  if (!requesterId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { userId } = req.query;

  if (userId && (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId))) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const filter =
      requesterRole === 'admin'
        ? userId
          ? { userId }
          : {}
        : { userId: requesterId };
    const notes = await Note.find(filter).sort({ createdAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notes', error });
  }
});

router.post('/', async (req, res) => {
  const { requesterId, requesterRole } = getRequester(req);
  if (!requesterId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const rawUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const userId = requesterRole === 'admin' ? rawUserId : requesterId;

  if (!userId || !title || !content) {
    return res.status(400).json({ message: 'User id, title and content are required' });
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const note = await Note.create({ userId, title, content });
    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error creating note', error });
  }
});

router.patch('/:id', async (req, res) => {
  const { requesterId, requesterRole } = getRequester(req);
  if (!requesterId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid note id' });
  }

  if (!title && !content) {
    return res.status(400).json({ message: 'Provide title or content to update' });
  }

  try {
    const update: Record<string, string> = {};
    if (title) {
      update.title = title;
    }
    if (content) {
      update.content = content;
    }

    const filter =
      requesterRole === 'admin'
        ? { _id: id }
        : { _id: id, userId: requesterId };

    const note = await Note.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    });

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error updating note', error });
  }
});

router.delete('/:id', async (req, res) => {
  const { requesterId, requesterRole } = getRequester(req);
  if (!requesterId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid note id' });
  }

  try {
    const filter =
      requesterRole === 'admin'
        ? { _id: id }
        : { _id: id, userId: requesterId };

    const result = await Note.findOneAndDelete(filter);
    if (!result) {
      return res.status(404).json({ message: 'Note not found' });
    }
    res.json({ message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting note', error });
  }
});

export default router;
