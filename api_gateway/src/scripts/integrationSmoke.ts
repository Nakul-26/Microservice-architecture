import dotenv from 'dotenv';

dotenv.config();

type LoginResponse = {
  token: string;
  user: {
    _id: string;
    email: string;
    role: 'admin' | 'user';
    name?: string;
  };
};

type NoteResponse = {
  _id: string;
  userId: string;
  title: string;
  content: string;
};

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const email = process.env.SMOKE_EMAIL ?? '';
const password = process.env.SMOKE_PASSWORD ?? '';
const requestTimeoutMs = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? '8000', 10);

if (!email || !password) {
  process.stderr.write(
    'Missing credentials. Set SMOKE_EMAIL and SMOKE_PASSWORD before running smoke test.\n'
  );
  process.exit(1);
}

const fetchWithTimeout = async (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readJson = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

const run = async () => {
  const runId = Date.now();
  let token = '';
  let noteId = '';
  let userId = '';

  try {
    const loginResponse = await fetchWithTimeout(`${baseUrl}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!loginResponse.ok) {
      const text = await loginResponse.text();
      throw new Error(`Login failed (${loginResponse.status}): ${text}`);
    }

    const loginBody = await readJson<LoginResponse>(loginResponse);
    token = loginBody.token;
    userId = loginBody.user._id;

    if (!token || !userId) {
      throw new Error('Login response missing token or user id');
    }

    const title = `smoke-title-${runId}`;
    const content = `smoke-content-${runId}`;

    const createResponse = await fetchWithTimeout(`${baseUrl}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        title,
        content,
      }),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(`Create note failed (${createResponse.status}): ${text}`);
    }

    const createdNote = await readJson<NoteResponse>(createResponse);
    noteId = createdNote._id;

    if (!noteId) {
      throw new Error('Create note response missing note id');
    }

    const listResponse = await fetchWithTimeout(`${baseUrl}/notes`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!listResponse.ok) {
      const text = await listResponse.text();
      throw new Error(`Fetch notes failed (${listResponse.status}): ${text}`);
    }

    const notes = await readJson<NoteResponse[]>(listResponse);
    const found = notes.find((note) => note._id === noteId);
    if (!found) {
      throw new Error('Created note was not returned by notes list');
    }

    const deleteResponse = await fetchWithTimeout(`${baseUrl}/notes/${noteId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!deleteResponse.ok) {
      const text = await deleteResponse.text();
      throw new Error(`Delete note failed (${deleteResponse.status}): ${text}`);
    }

    noteId = '';
    process.stdout.write('Smoke test passed: login -> create note -> fetch notes -> delete note\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Smoke test failed: ${message}\n`);

    if (token && noteId) {
      try {
        await fetchWithTimeout(`${baseUrl}/notes/${noteId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // Best-effort cleanup only.
      }
    }

    process.exit(1);
  }
};

void run();
