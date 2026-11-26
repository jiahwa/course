-- 书架层：远景里的一层。层是空间，可以被命名，也可以是空的。
CREATE TABLE IF NOT EXISTS shelves (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE courses ADD COLUMN shelf_id INTEGER REFERENCES shelves(id);

CREATE INDEX IF NOT EXISTS idx_courses_shelf ON courses(shelf_id);

-- 初始三层：现有课程落第 1 层，上面两层留空，远景一进去就有上下可切。
INSERT INTO shelves (uid, name, ord, created_at) VALUES
  ('s001', '第 1 层', 1, datetime('now')),
  ('s002', '第 2 层', 2, datetime('now')),
  ('s003', '第 3 层', 3, datetime('now'));

UPDATE courses SET shelf_id = 1 WHERE shelf_id IS NULL;
