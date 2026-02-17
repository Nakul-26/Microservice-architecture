import { useEffect, useMemo, useState } from 'react'
import './App.css'

type User = {
  _id: string
  name: string
  email: string
  role?: 'admin' | 'user'
  createdAt?: string
  updatedAt?: string
}

type Note = {
  _id: string
  userId: string
  title: string
  content: string
  createdAt?: string
  updatedAt?: string
}

const API_GATEWAY_BASE = 'http://localhost:3000'
const AUTH_TOKEN_KEY = 'auth_token'
const AUTH_USER_KEY = 'auth_user'

function App() {
  const [view, setView] = useState<'login' | 'users' | 'notes'>('login')

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [loginMessage, setLoginMessage] = useState('')
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  const [users, setUsers] = useState<User[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [createMessage, setCreateMessage] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editStatus, setEditStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editMessage, setEditMessage] = useState('')

  const [notes, setNotes] = useState<Note[]>([])
  const [notesStatus, setNotesStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [notesMessage, setNotesMessage] = useState('')
  const [notesSearch, setNotesSearch] = useState('')

  const [createNoteTitle, setCreateNoteTitle] = useState('')
  const [createNoteContent, setCreateNoteContent] = useState('')
  const [createNoteUserId, setCreateNoteUserId] = useState('')
  const [createNoteStatus, setCreateNoteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [createNoteMessage, setCreateNoteMessage] = useState('')

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteTitle, setEditNoteTitle] = useState('')
  const [editNoteContent, setEditNoteContent] = useState('')
  const [editNoteStatus, setEditNoteStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editNoteMessage, setEditNoteMessage] = useState('')
  const isAdmin = loggedInUser?.role === 'admin'

  const handleUnauthorized = () => {
    setAuthToken(null)
    setLoggedInUser(null)
    setView('login')
    setLoginStatus('error')
    setLoginMessage('Session expired. Please login again.')
    setUsers([])
    setNotes([])
  }

  const authFetch = async (input: string, init?: RequestInit) => {
    if (!authToken) {
      handleUnauthorized()
      throw new Error('Please login to continue')
    }

    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${authToken}`)

    const response = await fetch(input, {
      ...init,
      headers,
    })

    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('Session expired. Please login again.')
    }

    return response
  }

  const fetchUsers = async () => {
    setStatus('loading')
    setMessage('')

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/users`)
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to load users')
      }

      const data = (await response.json()) as User[]
      setUsers(data)
      setStatus('idle')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setStatus('error')
      setMessage(errorMessage)
    }
  }

  const fetchNotes = async () => {
    setNotesStatus('loading')
    setNotesMessage('')

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/notes`)
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to load notes')
      }

      const data = (await response.json()) as Note[]
      setNotes(data)
      setNotesStatus('idle')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setNotesStatus('error')
      setNotesMessage(errorMessage)
    }
  }

  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY)
    const storedUserRaw = localStorage.getItem(AUTH_USER_KEY)

    if (!storedToken || !storedUserRaw) {
      return
    }

    try {
      const storedUser = JSON.parse(storedUserRaw) as User
      setAuthToken(storedToken)
      setLoggedInUser(storedUser)
      setView(storedUser.role === 'admin' ? 'users' : 'notes')
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      localStorage.removeItem(AUTH_USER_KEY)
    }
  }, [])

  useEffect(() => {
    if (!authToken || !loggedInUser) {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      localStorage.removeItem(AUTH_USER_KEY)
      return
    }

    localStorage.setItem(AUTH_TOKEN_KEY, authToken)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(loggedInUser))
  }, [authToken, loggedInUser])

  useEffect(() => {
    if (!authToken) {
      return
    }

    if (isAdmin) {
      void fetchUsers()
    } else {
      setUsers([])
    }
    void fetchNotes()
  }, [authToken, isAdmin])

  useEffect(() => {
    if (!isAdmin && loggedInUser) {
      setCreateNoteUserId(loggedInUser._id)
      return
    }

    if (loggedInUser && users.some((user) => user._id === loggedInUser._id)) {
      setCreateNoteUserId(loggedInUser._id)
      return
    }

    if (users.length > 0 && !createNoteUserId) {
      setCreateNoteUserId(users[0]._id)
    }
  }, [users, loggedInUser, createNoteUserId, isAdmin])

  useEffect(() => {
    if (loggedInUser && !isAdmin && view === 'users') {
      setView('notes')
    }
  }, [loggedInUser, isAdmin, view])

  const userNameById = useMemo(() => {
    return new Map(users.map((user) => [user._id, user.name]))
  }, [users])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((user) => user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term))
  }, [search, users])

  const filteredNotes = useMemo(() => {
    const term = notesSearch.trim().toLowerCase()
    if (!term) return notes
    return notes.filter((note) => {
      const ownerName = userNameById.get(note.userId)?.toLowerCase() ?? ''
      return (
        note.title.toLowerCase().includes(term) ||
        note.content.toLowerCase().includes(term) ||
        ownerName.includes(term)
      )
    })
  }, [notesSearch, notes, userNameById])

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateStatus('loading')
    setCreateMessage('')

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          email: createEmail,
          password: createPassword,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to create user')
      }

      setCreateStatus('success')
      setCreateMessage('User created successfully.')
      setCreateName('')
      setCreateEmail('')
      setCreatePassword('')
      await fetchUsers()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setCreateStatus('error')
      setCreateMessage(errorMessage)
    }
  }

  const startEdit = (user: User) => {
    setEditingId(user._id)
    setEditName(user.name)
    setEditEmail(user.email)
    setEditStatus('idle')
    setEditMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditEmail('')
    setEditMessage('')
    setEditStatus('idle')
  }

  const saveEdit = async () => {
    if (!editingId) return
    setEditStatus('loading')
    setEditMessage('')

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/users/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, email: editEmail }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to update user')
      }

      await fetchUsers()
      setEditStatus('idle')
      cancelEdit()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setEditStatus('error')
      setEditMessage(errorMessage)
    }
  }

  const handleDelete = async (user: User) => {
    const confirmed = window.confirm(`Delete ${user.name}? This cannot be undone.`)
    if (!confirmed) return

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/users/${user._id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to delete user')
      }
      await fetchUsers()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setMessage(errorMessage)
      setStatus('error')
    }
  }

  const handleCreateNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateNoteStatus('loading')
    setCreateNoteMessage('')

    if (!createNoteUserId) {
      if (!isAdmin) {
        setCreateNoteUserId(loggedInUser?._id ?? '')
      }
    }

    const ownerId = isAdmin ? createNoteUserId : (loggedInUser?._id ?? '')

    if (!ownerId) {
      setCreateNoteStatus('error')
      setCreateNoteMessage('Select a user for this note.')
      return
    }

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: ownerId,
          title: createNoteTitle,
          content: createNoteContent,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to create note')
      }

      setCreateNoteStatus('success')
      setCreateNoteMessage('Note created successfully.')
      setCreateNoteTitle('')
      setCreateNoteContent('')
      await fetchNotes()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setCreateNoteStatus('error')
      setCreateNoteMessage(errorMessage)
    }
  }

  const startEditNote = (note: Note) => {
    setEditingNoteId(note._id)
    setEditNoteTitle(note.title)
    setEditNoteContent(note.content)
    setEditNoteStatus('idle')
    setEditNoteMessage('')
  }

  const cancelEditNote = () => {
    setEditingNoteId(null)
    setEditNoteTitle('')
    setEditNoteContent('')
    setEditNoteStatus('idle')
    setEditNoteMessage('')
  }

  const saveEditNote = async () => {
    if (!editingNoteId) return
    setEditNoteStatus('loading')
    setEditNoteMessage('')

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/notes/${editingNoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editNoteTitle, content: editNoteContent }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to update note')
      }

      await fetchNotes()
      cancelEditNote()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setEditNoteStatus('error')
      setEditNoteMessage(errorMessage)
    }
  }

  const handleDeleteNote = async (note: Note) => {
    const confirmed = window.confirm(`Delete note "${note.title}"? This cannot be undone.`)
    if (!confirmed) return

    try {
      const response = await authFetch(`${API_GATEWAY_BASE}/notes/${note._id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Failed to delete note')
      }
      await fetchNotes()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setNotesMessage(errorMessage)
      setNotesStatus('error')
    }
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginStatus('loading')
    setLoginMessage('')

    try {
      const response = await fetch(`${API_GATEWAY_BASE}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.message || 'Login failed')
      }

      const data = await response.json()
      const token = data?.token as string | undefined
      const user = data?.user as User | undefined
      if (!token || !user) {
        throw new Error('Login response is invalid')
      }
      const name = user?.name ?? 'there'
      setLoginStatus('success')
      setLoginMessage(`Welcome back, ${name}.`)
      setAuthToken(token)
      setLoggedInUser(user)
      setView(user.role === 'admin' ? 'users' : 'notes')
      setLoginEmail('')
      setLoginPassword('')
      setShowLoginPassword(false)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setLoginStatus('error')
      setLoginMessage(errorMessage)
    }
  }

  const handleLogout = () => {
    setAuthToken(null)
    setLoggedInUser(null)
    setView('login')
    setLoginStatus('idle')
    setLoginMessage('You have been logged out.')
    setShowLoginPassword(false)
    setUsers([])
    setNotes([])
  }

  const requireLogin = () => {
    setView('login')
    setLoginStatus('error')
    setLoginMessage('Please login to access the dashboard.')
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="brand">Microservices Console</p>
          <h1>
            {view === 'login' ? 'Team Login' : view === 'users' ? 'User Management' : 'Notes Management'}
          </h1>
          <p className="subtitle">
            {view === 'login'
              ? 'Access the console with your team credentials.'
              : view === 'users'
                ? 'Create, edit, and maintain the user directory in one place.'
                : 'Add, edit, delete, and browse all notes from a single dashboard.'}
          </p>
        </div>
        <div className="nav-actions">
          <button
            className={view === 'login' ? 'primary' : 'ghost'}
            type="button"
            onClick={() => (loggedInUser ? handleLogout() : setView('login'))}
          >
            {loggedInUser ? 'Logout' : 'Login'}
          </button>
          <button
            className={view === 'users' ? 'primary' : 'ghost'}
            type="button"
            onClick={() => (loggedInUser && isAdmin ? setView('users') : requireLogin())}
            disabled={loggedInUser ? !isAdmin : false}
          >
            Users
          </button>
          <button
            className={view === 'notes' ? 'primary' : 'ghost'}
            type="button"
            onClick={() => (loggedInUser ? setView('notes') : requireLogin())}
          >
            Notes
          </button>
          {view === 'users' && loggedInUser ? (
            <button className="ghost" type="button" onClick={fetchUsers} disabled={status === 'loading'}>
              {status === 'loading' ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : null}
          {view === 'notes' && loggedInUser ? (
            <button className="ghost" type="button" onClick={fetchNotes} disabled={notesStatus === 'loading'}>
              {notesStatus === 'loading' ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </header>

      <main className="content">
        {!loggedInUser || view === 'login' ? (
          <section className="panel login-panel">
            <div className="panel-header">
              <div>
                <h2>Sign In</h2>
                <p>Use your team email to access the dashboard.</p>
              </div>
            </div>
            <form className="form-grid login-form" onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  name="login-email"
                  type="email"
                  placeholder="you@company.com"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <div className="password-input-wrap">
                  <input
                    id="login-password"
                    name="login-password"
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                  <button
                    className="ghost password-toggle"
                    type="button"
                    onClick={() => setShowLoginPassword((current) => !current)}
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                  >
                    {showLoginPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div className="actions">
                <button className="primary" type="submit" disabled={loginStatus === 'loading'}>
                  {loginStatus === 'loading' ? 'Signing in...' : 'Login'}
                </button>
                {loginMessage ? <p className={`status ${loginStatus}`}>{loginMessage}</p> : null}
              </div>
            </form>
          </section>
        ) : null}

        {loggedInUser && isAdmin && view === 'users' ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Create New User</h2>
                  <p>Invite teammates and set them up with a login.</p>
                </div>
              </div>
              <form className="form-grid" onSubmit={handleCreate}>
                <div className="field">
                  <label htmlFor="create-name">Name</label>
                  <input
                    id="create-name"
                    name="create-name"
                    type="text"
                    placeholder="Jane Doe"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="create-email">Email</label>
                  <input
                    id="create-email"
                    name="create-email"
                    type="email"
                    placeholder="jane@company.com"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="create-password">Password</label>
                  <input
                    id="create-password"
                    name="create-password"
                    type="password"
                    placeholder="Set a secure password"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    required
                  />
                </div>
                <div className="actions">
                  <button className="primary" type="submit" disabled={createStatus === 'loading'}>
                    {createStatus === 'loading' ? 'Creating...' : 'Create User'}
                  </button>
                  {createMessage ? <p className={`status ${createStatus}`}>{createMessage}</p> : null}
                </div>
              </form>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>All Users</h2>
                  <p>
                    {filteredUsers.length} of {users.length} users displayed
                  </p>
                </div>
                <div className="search">
                  <input
                    type="search"
                    placeholder="Search by name or email"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>

              {status === 'error' ? <p className="status error">{message}</p> : null}

              <div className="list">
                {filteredUsers.map((user) => {
                  const isEditing = editingId === user._id
                  const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A'
                  const updatedAt = user.updatedAt ? new Date(user.updatedAt).toLocaleString() : 'N/A'
                  return (
                    <div key={user._id} className="user-card">
                      <div className="user-info">
                        {isEditing ? (
                          <>
                            <input
                              className="inline-input"
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              placeholder="Name"
                            />
                            <input
                              className="inline-input"
                              value={editEmail}
                              onChange={(event) => setEditEmail(event.target.value)}
                              placeholder="Email"
                              type="email"
                            />
                          </>
                        ) : (
                          <>
                            <h3>{user.name}</h3>
                            <p>{user.email}</p>
                          </>
                        )}
                        <div className="meta">
                          <span>Created: {createdAt}</span>
                          <span>Updated: {updatedAt}</span>
                        </div>
                        {isEditing && editMessage ? <p className="status error">{editMessage}</p> : null}
                      </div>
                      <div className="user-actions">
                        {isEditing ? (
                          <>
                            <button className="primary" type="button" onClick={saveEdit} disabled={editStatus === 'loading'}>
                              {editStatus === 'loading' ? 'Saving...' : 'Save'}
                            </button>
                            <button className="ghost" type="button" onClick={cancelEdit}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="ghost" type="button" onClick={() => startEdit(user)}>
                              Edit
                            </button>
                            <button className="danger" type="button" onClick={() => handleDelete(user)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
                {filteredUsers.length === 0 && status !== 'loading' ? (
                  <p className="empty">No users found. Try a different search or create a new user.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {loggedInUser && view === 'notes' ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Add Note</h2>
                  <p>Create a new note with title, content, and an owner.</p>
                </div>
              </div>
              <form className="form-grid" onSubmit={handleCreateNote}>
                <div className="field">
                  <label htmlFor="create-note-user">Owner</label>
                  {isAdmin ? (
                    <select
                      id="create-note-user"
                      name="create-note-user"
                      value={createNoteUserId}
                      onChange={(event) => setCreateNoteUserId(event.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Select a user
                      </option>
                      {users.map((user) => (
                        <option key={user._id} value={user._id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" value={loggedInUser?.name ?? 'You'} disabled />
                  )}
                </div>
                <div className="field">
                  <label htmlFor="create-note-title">Title</label>
                  <input
                    id="create-note-title"
                    name="create-note-title"
                    type="text"
                    placeholder="Meeting summary"
                    value={createNoteTitle}
                    onChange={(event) => setCreateNoteTitle(event.target.value)}
                    required
                  />
                </div>
                <div className="field field-full">
                  <label htmlFor="create-note-content">Content</label>
                  <textarea
                    id="create-note-content"
                    name="create-note-content"
                    placeholder="Write your note..."
                    value={createNoteContent}
                    onChange={(event) => setCreateNoteContent(event.target.value)}
                    required
                    rows={4}
                  />
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    type="submit"
                    disabled={createNoteStatus === 'loading' || (isAdmin && users.length === 0)}
                  >
                    {createNoteStatus === 'loading' ? 'Creating...' : 'Add Note'}
                  </button>
                  {createNoteMessage ? <p className={`status ${createNoteStatus}`}>{createNoteMessage}</p> : null}
                </div>
              </form>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>All Notes</h2>
                  <p>
                    {filteredNotes.length} of {notes.length} notes displayed
                  </p>
                </div>
                <div className="search">
                  <input
                    type="search"
                    placeholder="Search by title, content, or owner"
                    value={notesSearch}
                    onChange={(event) => setNotesSearch(event.target.value)}
                  />
                </div>
              </div>

              {notesStatus === 'error' ? <p className="status error">{notesMessage}</p> : null}

              <div className="list">
                {filteredNotes.map((note) => {
                  const isEditing = editingNoteId === note._id
                  const createdAt = note.createdAt ? new Date(note.createdAt).toLocaleString() : 'N/A'
                  const updatedAt = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : 'N/A'
                  return (
                    <div key={note._id} className="user-card">
                      <div className="user-info">
                        {isEditing ? (
                          <>
                            <input
                              className="inline-input"
                              value={editNoteTitle}
                              onChange={(event) => setEditNoteTitle(event.target.value)}
                              placeholder="Title"
                            />
                            <textarea
                              className="inline-input"
                              value={editNoteContent}
                              onChange={(event) => setEditNoteContent(event.target.value)}
                              placeholder="Content"
                              rows={4}
                            />
                          </>
                        ) : (
                          <>
                            <h3>{note.title}</h3>
                            <p>{note.content}</p>
                            <p>Owner: {userNameById.get(note.userId) ?? note.userId}</p>
                          </>
                        )}
                        <div className="meta">
                          <span>Created: {createdAt}</span>
                          <span>Updated: {updatedAt}</span>
                        </div>
                        {isEditing && editNoteMessage ? <p className="status error">{editNoteMessage}</p> : null}
                      </div>
                      <div className="user-actions">
                        {isEditing ? (
                          <>
                            <button
                              className="primary"
                              type="button"
                              onClick={saveEditNote}
                              disabled={editNoteStatus === 'loading'}
                            >
                              {editNoteStatus === 'loading' ? 'Saving...' : 'Save'}
                            </button>
                            <button className="ghost" type="button" onClick={cancelEditNote}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="ghost" type="button" onClick={() => startEditNote(note)}>
                              Edit
                            </button>
                            <button className="danger" type="button" onClick={() => handleDeleteNote(note)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
                {filteredNotes.length === 0 && notesStatus !== 'loading' ? (
                  <p className="empty">No notes found. Try a different search or add a new note.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

export default App
