const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Append-only list of migrations. Index + 1 is stored in PRAGMA user_version. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
    enabled INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    paused_reason TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    content_html TEXT,
    summary TEXT,
    author TEXT,
    image_url TEXT,
    categories TEXT NOT NULL DEFAULT '[]',
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    sort_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    purged INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source_id, guid)
  );
  CREATE INDEX idx_items_sort ON items (sort_at DESC, id DESC) WHERE purged = 0;
  CREATE INDEX idx_items_source_sort ON items (source_id, sort_at DESC, id DESC) WHERE purged = 0;

  CREATE VIRTUAL TABLE items_fts USING fts5(
    title, summary, content_html, author,
    content = 'items', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts (rowid, title, summary, content_html, author)
    VALUES (new.id, new.title, new.summary, new.content_html, new.author);
  END;
  CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, title, summary, content_html, author)
    VALUES ('delete', old.id, old.title, old.summary, old.content_html, old.author);
  END;
  CREATE TRIGGER items_au AFTER UPDATE OF title, summary, content_html, author ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, title, summary, content_html, author)
    VALUES ('delete', old.id, old.title, old.summary, old.content_html, old.author);
    INSERT INTO items_fts (rowid, title, summary, content_html, author)
    VALUES (new.id, new.title, new.summary, new.content_html, new.author);
  END;

  CREATE TABLE fetch_log (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'not_modified', 'error')),
    http_status INTEGER,
    new_items INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE INDEX idx_fetch_log_source ON fetch_log (source_id, id DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: authentication and per-user read/star state (items.is_read/is_starred become legacy,
  // only used once to hand the pre-auth state over to the first admin).
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions (user_id);

  CREATE TABLE item_states (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, item_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_item_states_item ON item_states (item_id);
  `,
];
