CREATE TABLE papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1950 AND 2100),
  scope TEXT NOT NULL CHECK (scope IN ('national', 'regional')),
  series TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX papers_public_filter ON papers (status, year DESC, scope, subject, id DESC);
CREATE INDEX papers_subject_filter ON papers (status, subject, year DESC, id DESC);
CREATE INDEX papers_candidate_match ON papers (year, scope, series, subject);

CREATE TABLE paper_regions (
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  PRIMARY KEY (paper_id, region)
);

CREATE INDEX paper_regions_region ON paper_regions (region, paper_id);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('source', 'drive')),
  source_name TEXT,
  source_url TEXT,
  access_code TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (paper_id, format, url)
);

CREATE INDEX resources_paper ON resources (paper_id, id);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  external_key TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  scope TEXT CHECK (scope IN ('national', 'regional')),
  series TEXT,
  subject TEXT,
  regions_json TEXT NOT NULL DEFAULT '[]',
  format TEXT,
  resource_url TEXT,
  source_url TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'uncertain' CHECK (classification IN ('ordinary', 'uncertain')),
  raw_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE (source_key, external_key)
);

CREATE INDEX candidates_review_queue ON candidates (review_status, updated_at DESC, id DESC);

CREATE VIRTUAL TABLE paper_titles USING fts5(title, content='papers', content_rowid='id', tokenize='trigram');

CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO paper_titles(rowid, title) VALUES (new.id, new.title);
END;

CREATE TRIGGER papers_fts_update AFTER UPDATE OF title ON papers BEGIN
  INSERT INTO paper_titles(paper_titles, rowid, title) VALUES ('delete', old.id, old.title);
  INSERT INTO paper_titles(rowid, title) VALUES (new.id, new.title);
END;

CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
  INSERT INTO paper_titles(paper_titles, rowid, title) VALUES ('delete', old.id, old.title);
END;
