import express from 'express';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import jwt from 'jsonwebtoken';

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
type UserRole = 'admin' | 'user';

const getRequester = (req: express.Request) => {
  const requesterId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : '';
  const requesterRole = req.headers['x-user-role'] === 'admin' ? 'admin' : 'user';
  return { requesterId, requesterRole: requesterRole as UserRole };
};

const requireAdmin = (req: express.Request, res: express.Response) => {
  const { requesterRole } = getRequester(req);
  if (requesterRole !== 'admin') {
    res.status(403).json({ message: 'Forbidden: admin access required' });
    return false;
  }
  return true;
};

router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  try {
    const db = req.app.locals.db as Db | undefined;
    if (!db) {
      return res.status(500).json({ message: 'Database not initialized' });
    }

    const users = db.collection('users');
    const results = await users
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    const formatted = results.map((user) => ({
      ...user,
      _id: user._id.toString(),
      role: user.role === 'admin' ? 'admin' : 'user',
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users', error });
  }
});

router.post('/register', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role === 'admin' ? 'admin' : 'user';

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const db = req.app.locals.db as Db | undefined;
    if (!db) {
      return res.status(500).json({ message: 'Database not initialized' });
    }

    const users = db.collection('users');
    const existingUser = await users.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const result = await users.insertOne({
      name,
      email,
      password,
      role,
      createdAt: new Date(),
    });

    res.status(201).json({ userId: result.insertedId });
  } catch (error) {
    res.status(500).json({ message: 'Error registering user', error });
  }
});

router.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const db = req.app.locals.db as Db | undefined;
    if (!db) {
      return res.status(500).json({ message: 'Database not initialized' });
    }

    const users = db.collection('users');
    const user = await users.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    let userRole: UserRole = user.role === 'admin' ? 'admin' : 'user';
    if (!user.role) {
      const adminCount = await users.countDocuments({ role: 'admin' });
      if (adminCount === 0) {
        await users.updateOne({ _id: user._id }, { $set: { role: 'admin', updatedAt: new Date() } });
        userRole = 'admin';
      }
    }

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        email: user.email,
        name: user.name,
        role: userRole,
      },
      jwtSecret
    );

    res.json({
      token,
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: userRole,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error });
  }
});

router.patch('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  const { id } = req.params;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : undefined;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (!name && !email && !role) {
    return res.status(400).json({ message: 'Provide name, email, or role to update' });
  }

  try {
    const db = req.app.locals.db as Db | undefined;
    if (!db) {
      return res.status(500).json({ message: 'Database not initialized' });
    }

    const users = db.collection('users');

    if (email) {
      const existingUser = await users.findOne({
        email,
        _id: { $ne: new ObjectId(id) },
      });

      if (existingUser) {
        return res.status(409).json({ message: 'Email already registered' });
      }
    }

    const update: Record<string, string | Date> = {
      updatedAt: new Date(),
    };

    if (name) {
      update.name = name;
    }

    if (email) {
      update.email = email;
    }

    if (role) {
      update.role = role;
    }

    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user', error });
  }
});

router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const db = req.app.locals.db as Db | undefined;
    if (!db) {
      return res.status(500).json({ message: 'Database not initialized' });
    }

    const users = db.collection('users');
    const result = await users.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user', error });
  }
});

export default router;
