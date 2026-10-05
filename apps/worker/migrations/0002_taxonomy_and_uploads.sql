ALTER TABLE papers ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (origin_type IN ('national', 'provincial', 'joint', 'unknown'));
ALTER TABLE papers ADD COLUMN subject_role TEXT NOT NULL DEFAULT 'other'
  CHECK (subject_role IN ('unified', 'first_choice', 'second_choice', 'elective', 'integrated', 'other'));

UPDATE papers
SET origin_type = CASE scope WHEN 'national' THEN 'national' ELSE 'unknown' END,
    subject = CASE subject
      WHEN '政治' THEN '思想政治'
      WHEN '生物' THEN '生物学'
      WHEN '文综' THEN '文科综合'
      WHEN '理综' THEN '理科综合'
      WHEN '外语' THEN '英语'
      ELSE subject
    END;

CREATE TABLE _ceepp_region_aliases (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL
);

CREATE TABLE legacy_region_review (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('paper', 'candidate')),
  entity_id INTEGER NOT NULL,
  raw_region TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, raw_region)
);

INSERT INTO _ceepp_region_aliases (alias, canonical) VALUES
  ('北京', '北京'), ('天津', '天津'), ('河北', '河北'), ('山西', '山西'),
  ('内蒙古', '内蒙古'), ('辽宁', '辽宁'), ('吉林', '吉林'), ('黑龙江', '黑龙江'),
  ('上海', '上海'), ('江苏', '江苏'), ('浙江', '浙江'), ('安徽', '安徽'),
  ('福建', '福建'), ('江西', '江西'), ('山东', '山东'), ('河南', '河南'),
  ('湖北', '湖北'), ('湖南', '湖南'), ('广东', '广东'), ('广西', '广西'),
  ('海南', '海南'), ('重庆', '重庆'), ('四川', '四川'), ('贵州', '贵州'),
  ('云南', '云南'), ('西藏', '西藏'), ('陕西', '陕西'), ('甘肃', '甘肃'),
  ('青海', '青海'), ('宁夏', '宁夏'), ('新疆', '新疆'),
  ('北京市', '北京'), ('天津市', '天津'), ('河北省', '河北'), ('山西省', '山西'),
  ('内蒙古自治区', '内蒙古'), ('辽宁省', '辽宁'), ('吉林省', '吉林'), ('黑龙江省', '黑龙江'),
  ('上海市', '上海'), ('江苏省', '江苏'), ('浙江省', '浙江'), ('安徽省', '安徽'),
  ('福建省', '福建'), ('江西省', '江西'), ('山东省', '山东'), ('河南省', '河南'),
  ('湖北省', '湖北'), ('湖南省', '湖南'), ('广东省', '广东'), ('广西壮族自治区', '广西'),
  ('海南省', '海南'), ('重庆市', '重庆'), ('四川省', '四川'), ('贵州省', '贵州'),
  ('云南省', '云南'), ('西藏自治区', '西藏'), ('陕西省', '陕西'), ('甘肃省', '甘肃'),
  ('青海省', '青海'), ('宁夏回族自治区', '宁夏'), ('新疆维吾尔自治区', '新疆');

INSERT OR IGNORE INTO legacy_region_review (entity_type, entity_id, raw_region)
SELECT 'paper', paper_regions.paper_id, paper_regions.region
FROM paper_regions
LEFT JOIN _ceepp_region_aliases ON _ceepp_region_aliases.alias = paper_regions.region
WHERE _ceepp_region_aliases.alias IS NULL;

CREATE TABLE _ceepp_paper_regions_normalized (
  paper_id INTEGER NOT NULL,
  region TEXT NOT NULL,
  first_rowid INTEGER NOT NULL,
  PRIMARY KEY (paper_id, region)
);

INSERT INTO _ceepp_paper_regions_normalized (paper_id, region, first_rowid)
SELECT paper_regions.paper_id, _ceepp_region_aliases.canonical, MIN(paper_regions.rowid)
FROM paper_regions
JOIN _ceepp_region_aliases ON _ceepp_region_aliases.alias = paper_regions.region
GROUP BY paper_regions.paper_id, _ceepp_region_aliases.canonical;

DELETE FROM paper_regions;

INSERT INTO paper_regions (paper_id, region)
SELECT paper_id, region
FROM _ceepp_paper_regions_normalized
ORDER BY first_rowid;

DROP TABLE _ceepp_paper_regions_normalized;

CREATE INDEX papers_taxonomy_filter
  ON papers (status, year DESC, origin_type, subject_role, subject, id DESC);

DROP INDEX resources_paper;
ALTER TABLE resources RENAME TO resources_legacy;

CREATE TABLE resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'question'
    CHECK (kind IN ('question', 'answer', 'question_with_answer', 'analysis', 'listening_paper', 'listening_audio', 'other')),
  storage_type TEXT NOT NULL DEFAULT 'external' CHECK (storage_type IN ('external', 'upload')),
  url TEXT,
  link_type TEXT CHECK (link_type IN ('source', 'drive')),
  source_name TEXT,
  source_url TEXT,
  access_code TEXT,
  verified_at TEXT,
  storage_key TEXT UNIQUE,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  etag TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (storage_type = 'external' AND url IS NOT NULL AND link_type IS NOT NULL AND storage_key IS NULL)
    OR
    (storage_type = 'upload' AND url IS NULL AND link_type IS NULL AND storage_key IS NOT NULL
      AND filename IS NOT NULL AND mime_type IS NOT NULL AND size_bytes IS NOT NULL)
  ),
  UNIQUE (paper_id, format, url)
);

INSERT INTO resources
  (id, paper_id, format, kind, storage_type, url, link_type, source_name, source_url,
   access_code, verified_at, created_at)
SELECT id, paper_id, format, 'question', 'external', url, link_type, source_name, source_url,
       access_code, verified_at, created_at
FROM resources_legacy;

UPDATE resources
SET link_type = 'drive'
WHERE storage_type = 'external'
  AND link_type = 'source'
  AND (
    lower(source_name) = 'urongda'
    OR lower(url) LIKE 'https://%.ctfile.com/%'
    OR lower(url) LIKE 'http://%.ctfile.com/%'
    OR lower(url) LIKE 'https://ctfile.com/%'
    OR lower(url) LIKE 'http://ctfile.com/%'
  );

DROP TABLE resources_legacy;
CREATE INDEX resources_paper ON resources (paper_id, id);
CREATE INDEX resources_storage_usage ON resources (storage_type, size_bytes);

CREATE TABLE r2_cleanup_queue (
  storage_key TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('upload_pending', 'deleted_resource')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX r2_cleanup_queue_due
  ON r2_cleanup_queue (claimed_at, created_at, storage_key);

CREATE TRIGGER resources_clear_upload_pending AFTER INSERT ON resources
WHEN new.storage_type = 'upload'
BEGIN
  DELETE FROM r2_cleanup_queue WHERE storage_key = new.storage_key;
END;

CREATE TRIGGER resources_queue_uploaded_delete AFTER DELETE ON resources
WHEN old.storage_type = 'upload' AND old.storage_key IS NOT NULL
BEGIN
  INSERT INTO r2_cleanup_queue (storage_key, size_bytes, reason)
  VALUES (old.storage_key, COALESCE(old.size_bytes, 0), 'deleted_resource')
  ON CONFLICT(storage_key) DO UPDATE SET
    size_bytes = excluded.size_bytes,
    reason = excluded.reason,
    claimed_at = NULL,
    updated_at = datetime('now');
END;

ALTER TABLE candidates ADD COLUMN origin_type TEXT
  CHECK (origin_type IN ('national', 'provincial', 'joint', 'unknown'));
ALTER TABLE candidates ADD COLUMN subject_role TEXT
  CHECK (subject_role IN ('unified', 'first_choice', 'second_choice', 'elective', 'integrated', 'other'));
ALTER TABLE candidates ADD COLUMN resource_kind TEXT NOT NULL DEFAULT 'question'
  CHECK (resource_kind IN ('question', 'answer', 'question_with_answer', 'analysis', 'listening_paper', 'listening_audio', 'other'));
ALTER TABLE candidates ADD COLUMN resource_link_type TEXT NOT NULL DEFAULT 'source'
  CHECK (resource_link_type IN ('source', 'drive'));

UPDATE candidates
SET origin_type = CASE scope WHEN 'national' THEN 'national' ELSE 'unknown' END,
    subject_role = 'other',
    subject = CASE subject
      WHEN '政治' THEN '思想政治'
      WHEN '生物' THEN '生物学'
      WHEN '文综' THEN '文科综合'
      WHEN '理综' THEN '理科综合'
      WHEN '外语' THEN '英语'
      ELSE subject
    END,
    resource_link_type = CASE
      WHEN source_key = 'urongda'
        OR lower(resource_url) LIKE 'https://%.ctfile.com/%'
        OR lower(resource_url) LIKE 'http://%.ctfile.com/%'
        OR lower(resource_url) LIKE 'https://ctfile.com/%'
        OR lower(resource_url) LIKE 'http://ctfile.com/%'
      THEN 'drive'
      ELSE resource_link_type
    END;

INSERT OR IGNORE INTO legacy_region_review (entity_type, entity_id, raw_region)
SELECT 'candidate', candidate.id, CAST(item.value AS TEXT)
FROM candidates AS candidate
JOIN json_each(
  CASE
    WHEN json_valid(candidate.regions_json) THEN
      CASE WHEN json_type(candidate.regions_json) = 'array' THEN candidate.regions_json ELSE '[]' END
    ELSE '[]'
  END
) AS item
LEFT JOIN _ceepp_region_aliases AS mapping ON mapping.alias = CAST(item.value AS TEXT)
WHERE item.type = 'text' AND mapping.alias IS NULL;

UPDATE candidates AS candidate
SET regions_json = (
  SELECT COALESCE(json_group_array(region), '[]')
  FROM (
    SELECT mapping.canonical AS region,
           MIN(CAST(item.key AS INTEGER)) AS first_position
    FROM json_each(
      CASE
        WHEN json_valid(candidate.regions_json) THEN
          CASE WHEN json_type(candidate.regions_json) = 'array' THEN candidate.regions_json ELSE '[]' END
        ELSE '[]'
      END
    ) AS item
    JOIN _ceepp_region_aliases AS mapping ON mapping.alias = CAST(item.value AS TEXT)
    WHERE item.type = 'text'
    GROUP BY mapping.canonical
    ORDER BY first_position
  )
)
WHERE CASE
  WHEN json_valid(regions_json) THEN json_type(regions_json) = 'array'
  ELSE 0
END;

DROP TABLE _ceepp_region_aliases;
