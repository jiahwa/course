-- 0002：给课程与章节加不可变 uid。
-- 身份在创建那一刻确定，slug / 标题 / 所属课程都只是可变属性。
-- 历史行为 NULL，回填一次；唯一索引兜住重复。

ALTER TABLE courses ADD COLUMN uid TEXT;
ALTER TABLE chapters ADD COLUMN uid TEXT;

UPDATE courses SET uid = 'c' || substr(hex(randomblob(6)), 1, 12) WHERE uid IS NULL;
UPDATE chapters SET uid = 'h' || substr(hex(randomblob(6)), 1, 12) WHERE uid IS NULL;

CREATE UNIQUE INDEX idx_courses_uid ON courses(uid);
CREATE UNIQUE INDEX idx_chapters_uid ON chapters(uid);
