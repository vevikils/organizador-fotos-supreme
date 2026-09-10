const os = require('os');
// server/db.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'thumbnails');
const FACES_CACHE_DIR = path.join(__dirname, '..', 'cache', 'faces');
const DB_FILE = path.join(DATA_DIR, 'photos.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(FACES_CACHE_DIR)) fs.mkdirSync(FACES_CACHE_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -64000;
  PRAGMA foreign_keys = ON;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    date_taken TEXT,
    date_modified TEXT,
    year INTEGER,
    month INTEGER,
    day INTEGER,
    hour INTEGER,
    time_of_day TEXT,
    width INTEGER,
    height INTEGER,
    aspect_ratio REAL,
    orientation INTEGER DEFAULT 1,
    camera_make TEXT,
    camera_model TEXT,
    lens_model TEXT,
    focal_length REAL,
    aperture REAL,
    shutter_speed TEXT,
    iso INTEGER,
    latitude REAL,
    longitude REAL,
    altitude REAL,
    city TEXT,
    region TEXT,
    country TEXT,
    location_name TEXT,
    category TEXT DEFAULT 'photo',
    dominant_color TEXT,
    color_group TEXT,
    sha256 TEXT,
    dhash TEXT,
    is_favorite INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    thumbnail_path TEXT,
    is_nsfw INTEGER DEFAULT 0,
    nsfw_score REAL DEFAULT 0.0,
    nsfw_label TEXT DEFAULT 'sfw',
    nsfw_checked INTEGER DEFAULT 0,
    faces_scanned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(year, month, day);
  CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category);
  CREATE INDEX IF NOT EXISTS idx_photos_favorite ON photos(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_photos_sha256 ON photos(sha256);
  CREATE INDEX IF NOT EXISTS idx_photos_dhash ON photos(dhash);
  CREATE INDEX IF NOT EXISTS idx_photos_city ON photos(city);

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_scanned TEXT,
    photo_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    cover_photo_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS album_photos (
    album_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (album_id, photo_id),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT 'Persona',
    cover_crop_path TEXT,
    sample_photo_id INTEGER,
    photo_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS photo_faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    person_id INTEGER,
    box_x INTEGER,
    box_y INTEGER,
    box_w INTEGER,
    box_h INTEGER,
    confidence REAL,
    crop_path TEXT,
    embedding BLOB,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_photo_faces_photo ON photo_faces(photo_id);
  CREATE INDEX IF NOT EXISTS idx_photo_faces_person ON photo_faces(person_id);
`);

// Migración de columnas dinámicas para bases de datos existentes
function addCol(colName, colType) {
  try {
    const cols = db.prepare('PRAGMA table_info(photos)').all();
    if (!cols.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE photos ADD COLUMN ${colName} ${colType}`);
    }
  } catch (e) {}
}
addCol('is_nsfw', 'INTEGER DEFAULT 0');
addCol('nsfw_score', 'REAL DEFAULT 0.0');
addCol('nsfw_label', "TEXT DEFAULT 'sfw'");
addCol('nsfw_checked', 'INTEGER DEFAULT 0');
addCol('faces_scanned', 'INTEGER DEFAULT 0');

try { db.exec('CREATE INDEX IF NOT EXISTS idx_photos_nsfw ON photos(is_nsfw, nsfw_checked);'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_photos_faces_scanned ON photos(faces_scanned);'); } catch (e) {}

const countFolders = db.prepare('SELECT COUNT(*) as count FROM folders').get();
if (countFolders.count === 0) {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const defaultPictures = path.join(userProfile, 'Pictures');
  if (fs.existsSync(defaultPictures)) {
    db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').run(defaultPictures);
  }
}

const stmts = {
  upsertPhoto: db.prepare(`
    INSERT INTO photos (
      file_path, file_name, file_size, mime_type,
      date_taken, date_modified, year, month, day, hour, time_of_day,
      width, height, aspect_ratio, orientation,
      camera_make, camera_model, lens_model, focal_length, aperture, shutter_speed, iso,
      latitude, longitude, altitude, city, region, country, location_name,
      category, dominant_color, color_group, sha256, dhash, thumbnail_path
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(file_path) DO UPDATE SET
      date_modified = excluded.date_modified,
      file_size = excluded.file_size,
      latitude = COALESCE(excluded.latitude, photos.latitude),
      longitude = COALESCE(excluded.longitude, photos.longitude),
      city = COALESCE(excluded.city, photos.city),
      region = COALESCE(excluded.region, photos.region),
      country = COALESCE(excluded.country, photos.country),
      location_name = COALESCE(excluded.location_name, photos.location_name),
      category = excluded.category,
      dominant_color = excluded.dominant_color,
      color_group = excluded.color_group,
      dhash = excluded.dhash,
      thumbnail_path = COALESCE(excluded.thumbnail_path, photos.thumbnail_path)
  `),

  getPhotoById: db.prepare('SELECT * FROM photos WHERE id = ? AND is_deleted = 0'),
  getPhotoByPath: db.prepare('SELECT * FROM photos WHERE file_path = ? AND is_deleted = 0'),
  toggleFavorite: db.prepare('UPDATE photos SET is_favorite = (1 - is_favorite) WHERE id = ?'),
  setFavorite: db.prepare('UPDATE photos SET is_favorite = ? WHERE id = ?'),
  softDelete: db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?'),
  hardDelete: db.prepare('DELETE FROM photos WHERE id = ?'),

  getTimelineGroups: db.prepare(`
    SELECT year, month, COUNT(*) as count, MIN(id) as sample_photo_id
    FROM photos 
    WHERE is_deleted = 0 AND year IS NOT NULL AND year > 1970
    GROUP BY year, month 
    ORDER BY year DESC, month DESC
  `),

  getLocations: db.prepare(`
    SELECT city, country, COUNT(*) as count, AVG(latitude) as latitude, AVG(longitude) as longitude, MIN(id) as sample_photo_id
    FROM photos 
    WHERE is_deleted = 0 AND city IS NOT NULL AND latitude IS NOT NULL
    GROUP BY city, country 
    ORDER BY count DESC
  `),

  getCategories: db.prepare(`
    SELECT category, COUNT(*) as count, MIN(id) as sample_photo_id
    FROM photos 
    WHERE is_deleted = 0 
    GROUP BY category 
    ORDER BY count DESC
  `),

  getColors: db.prepare(`
    SELECT color_group, COUNT(*) as count, MIN(dominant_color) as sample_hex, MIN(id) as sample_photo_id
    FROM photos 
    WHERE is_deleted = 0 AND color_group IS NOT NULL
    GROUP BY color_group 
    ORDER BY count DESC
  `),

  getCameras: db.prepare(`
    SELECT COALESCE(camera_model, camera_make, 'Sin metadatos') as camera, COUNT(*) as count, MIN(id) as sample_photo_id
    FROM photos 
    WHERE is_deleted = 0 AND (camera_model IS NOT NULL OR camera_make IS NOT NULL)
    GROUP BY camera 
    ORDER BY count DESC
  `),

  getFolders: db.prepare('SELECT * FROM folders ORDER BY id ASC'),
  addFolder: db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)'),
  removeFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
  updateFolderScan: db.prepare('UPDATE folders SET last_scanned = CURRENT_TIMESTAMP, photo_count = ? WHERE id = ?'),

  getAlbums: db.prepare(`
    SELECT a.*, COUNT(ap.photo_id) as photo_count, MIN(p.thumbnail_path) as sample_thumb
    FROM albums a
    LEFT JOIN album_photos ap ON a.id = ap.album_id
    LEFT JOIN photos p ON ap.photo_id = p.id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `),
  createAlbum: db.prepare('INSERT INTO albums (title, description) VALUES (?, ?)'),
  addPhotoToAlbum: db.prepare('INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)'),
  removePhotoFromAlbum: db.prepare('DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?'),
  deleteAlbum: db.prepare('DELETE FROM albums WHERE id = ?'),

  getStats: db.prepare(`
    SELECT 
      COUNT(*) as total_photos,
      COALESCE(SUM(file_size), 0) as total_size,
      COUNT(DISTINCT city) as total_locations,
      (SELECT COUNT(*) FROM photos WHERE is_favorite = 1 AND is_deleted = 0) as total_favorites,
      (SELECT COUNT(*) FROM albums) as total_albums
    FROM photos 
    WHERE is_deleted = 0
  `),

  getNsfwStats: db.prepare(`
    SELECT 
      COUNT(*) as total_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND nsfw_checked = 1) as checked_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_nsfw = 1) as nsfw_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_nsfw = 0 AND nsfw_checked = 1) as sfw_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND nsfw_checked = 0) as unclassified_photos
    FROM photos 
    WHERE is_deleted = 0
  `),

  toggleNsfw: db.prepare('UPDATE photos SET is_nsfw = (1 - is_nsfw), nsfw_checked = 1 WHERE id = ?'),
  setNsfw: db.prepare('UPDATE photos SET is_nsfw = ?, nsfw_score = ?, nsfw_label = ?, nsfw_checked = 1 WHERE id = ?'),

  // Personas y Reconocimiento Facial
  getPersons: db.prepare(`
    SELECT p.*, 
      (SELECT COUNT(DISTINCT pf.photo_id) FROM photo_faces pf WHERE pf.person_id = p.id) as photo_count
    FROM persons p
    WHERE (SELECT COUNT(DISTINCT pf.photo_id) FROM photo_faces pf WHERE pf.person_id = p.id) > 0
    ORDER BY photo_count DESC, p.id ASC
  `),

  getPersonById: db.prepare(`
    SELECT p.*,
      (SELECT COUNT(DISTINCT pf.photo_id) FROM photo_faces pf WHERE pf.person_id = p.id) as photo_count
    FROM persons p WHERE p.id = ?
  `),

  renamePerson: db.prepare('UPDATE persons SET name = ? WHERE id = ?'),

  deletePerson: db.prepare('DELETE FROM persons WHERE id = ?'),

  getPhotosByPerson: db.prepare(`
    SELECT DISTINCT ph.*
    FROM photos ph
    INNER JOIN photo_faces pf ON pf.photo_id = ph.id
    WHERE pf.person_id = ? AND ph.is_deleted = 0
    ORDER BY ph.year DESC, ph.month DESC, ph.day DESC, ph.id DESC
  `),

  getFacesByPhotoId: db.prepare(`
    SELECT pf.*, p.name as person_name
    FROM photo_faces pf
    LEFT JOIN persons p ON p.id = pf.person_id
    WHERE pf.photo_id = ?
  `),

  getFaceStats: db.prepare(`
    SELECT 
      COUNT(*) as total_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND faces_scanned = 1) as scanned_photos,
      (SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND faces_scanned = 0) as unscanned_photos,
      (SELECT COUNT(*) FROM photo_faces) as total_faces,
      (SELECT COUNT(*) FROM persons) as total_persons
    FROM photos WHERE is_deleted = 0
  `)
};

function queryPhotos({
  limit = 100, offset = 0, year = null, month = null, category = null,
  color = null, camera = null, city = null, country = null, search = null,
  favorite = false, albumId = null, personId = null, sort = 'date_desc', nsfwFilter = 'all'
} = {}) {
  const conditions = ['is_deleted = 0'];
  const params = [];

  if (favorite) conditions.push('is_favorite = 1');
  if (nsfwFilter === 'safe_only') conditions.push('is_nsfw = 0');
  else if (nsfwFilter === 'nsfw_only') conditions.push('is_nsfw = 1');

  if (personId !== null && personId !== undefined && personId !== '') {
    conditions.push('id IN (SELECT photo_id FROM photo_faces WHERE person_id = ?)');
    params.push(Number(personId));
  }

  if (year !== null && year !== undefined && year !== '') {
    conditions.push('year = ?');
    params.push(Number(year));
  }
  if (month !== null && month !== undefined && month !== '') {
    conditions.push('month = ?');
    params.push(Number(month));
  }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (color) { conditions.push('color_group = ?'); params.push(color); }
  if (camera) { conditions.push('(camera_model = ? OR camera_make = ?)'); params.push(camera, camera); }
  if (city) { conditions.push('city = ?'); params.push(city); }
  if (country) { conditions.push('country = ?'); params.push(country); }
  if (albumId) {
    conditions.push('id IN (SELECT photo_id FROM album_photos WHERE album_id = ?)');
    params.push(Number(albumId));
  }
  if (search && search.trim() !== '') {
    const s = `%${search.trim()}%`;
    conditions.push(`(file_name LIKE ? OR city LIKE ? OR country LIKE ? OR location_name LIKE ? OR category LIKE ? OR camera_model LIKE ? OR color_group LIKE ? OR year LIKE ?)`);
    params.push(s, s, s, s, s, s, s, s);
  }

  let orderBy = 'date_taken DESC, id DESC';
  if (sort === 'date_asc') orderBy = 'date_taken ASC, id ASC';
  else if (sort === 'size_desc') orderBy = 'file_size DESC';
  else if (sort === 'size_asc') orderBy = 'file_size ASC';
  else if (sort === 'name_asc') orderBy = 'file_name ASC';

  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const totalCount = db.prepare(`SELECT COUNT(*) as total FROM photos ${whereClause}`).get(...params).total;
  const photos = db.prepare(`SELECT * FROM photos ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { total: totalCount, limit, offset, photos };
}

function findDuplicates(options = { tab: 'all' }) {
  const tab = (options && options.tab) || 'all';

  let exactGroups = {};
  let reclaimableBytes = 0;
  let exactCount = 0;

  if (tab === 'exact' || tab === 'all') {
    const exactDuplicates = db.prepare(`
      SELECT p.* FROM photos p
      INNER JOIN (
        SELECT sha256 FROM photos WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
        GROUP BY sha256 HAVING COUNT(*) > 1
      ) dup ON p.sha256 = dup.sha256
      WHERE p.is_deleted = 0
      ORDER BY p.sha256, (COALESCE(p.width * p.height, 0)) DESC, p.file_size DESC, p.id ASC
    `).all();

    for (const photo of exactDuplicates) {
      if (!exactGroups[photo.sha256]) exactGroups[photo.sha256] = [];
      exactGroups[photo.sha256].push(photo);
    }
    exactCount = Object.keys(exactGroups).length;

    for (const group of Object.values(exactGroups)) {
      const sizes = group.map(p => p.file_size).sort((a, b) => b - a);
      for (let i = 1; i < sizes.length; i++) reclaimableBytes += sizes[i];
    }
  } else {
    const countRow = db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT sha256 FROM photos WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
        GROUP BY sha256 HAVING COUNT(*) > 1
      )
    `).get();
    exactCount = countRow ? (countRow.c || 0) : 0;
  }

  let filteredSimilarGroups = {};
  let similarCount = 0;

  if (tab === 'similar' || tab === 'all') {
    const similarPhotos = db.prepare(`
      SELECT p.* FROM photos p
      INNER JOIN (
        SELECT dhash FROM photos WHERE is_deleted = 0 AND dhash IS NOT NULL AND dhash != ''
        GROUP BY dhash HAVING COUNT(*) > 1
      ) dup ON p.dhash = dup.dhash
      WHERE p.is_deleted = 0
      ORDER BY p.dhash, (COALESCE(p.width * p.height, 0)) DESC, p.file_size DESC, p.id ASC
    `).all();

    const similarGroups = {};
    for (const photo of similarPhotos) {
      if (!similarGroups[photo.dhash]) similarGroups[photo.dhash] = [];
      similarGroups[photo.dhash].push(photo);
    }

    for (const [dhash, group] of Object.entries(similarGroups)) {
      const shaSet = new Set(group.map(p => p.sha256));
      if (shaSet.size > 1) filteredSimilarGroups[dhash] = group;
    }
    similarCount = Object.keys(filteredSimilarGroups).length;
  } else {
    const countRow = db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT dhash FROM photos WHERE is_deleted = 0 AND dhash IS NOT NULL AND dhash != ''
        GROUP BY dhash HAVING COUNT(*) > 1
      )
    `).get();
    similarCount = countRow ? (countRow.c || 0) : 0;
  }

  return {
    exactCount,
    exactGroups: Object.values(exactGroups),
    similarCount,
    similarGroups: Object.values(filteredSimilarGroups),
    reclaimableBytes
  };
}

function cleanAllDuplicates(type = 'exact') {
  const deleteStmt = db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?');
  let deletedCount = 0;
  let reclaimedBytes = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    if (type === 'exact' || type === 'all') {
      const rows = db.prepare(`
        SELECT p.id, p.sha256, p.file_size, p.width, p.height
        FROM photos p
        INNER JOIN (
          SELECT sha256 FROM photos 
          WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
          GROUP BY sha256 HAVING COUNT(*) > 1
        ) dup ON p.sha256 = dup.sha256
        WHERE p.is_deleted = 0
        ORDER BY p.sha256, (COALESCE(p.width * p.height, 0)) DESC, p.file_size DESC, p.id ASC
      `).all();

      let currentSha = null;
      for (const row of rows) {
        if (row.sha256 !== currentSha) {
          currentSha = row.sha256;
        } else {
          deleteStmt.run(row.id);
          deletedCount++;
          reclaimedBytes += (row.file_size || 0);
        }
      }
    }

    if (type === 'similar' || type === 'all') {
      const rows = db.prepare(`
        SELECT p.id, p.dhash, p.file_size, p.width, p.height
        FROM photos p
        INNER JOIN (
          SELECT dhash FROM photos 
          WHERE is_deleted = 0 AND dhash IS NOT NULL AND dhash != ''
          GROUP BY dhash HAVING COUNT(*) > 1
        ) dup ON p.dhash = dup.dhash
        WHERE p.is_deleted = 0
        ORDER BY p.dhash, (COALESCE(p.width * p.height, 0)) DESC, p.file_size DESC, p.id ASC
      `).all();

      let currentDhash = null;
      for (const row of rows) {
        if (row.dhash !== currentDhash) {
          currentDhash = row.dhash;
        } else {
          deleteStmt.run(row.id);
          deletedCount++;
          reclaimedBytes += (row.file_size || 0);
        }
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { deletedCount, reclaimedBytes };
}

function batchDeletePhotos(photoIds = []) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return { count: 0 };
  }
  const deleteStmt = db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?');
  let count = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const id of photoIds) {
      deleteStmt.run(id);
      count++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { count };
}

function getDuplicateStats() {
  try {
    const exactRow = db.prepare(`
      SELECT COUNT(*) as exactCount FROM (
        SELECT sha256 FROM photos 
        WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
        GROUP BY sha256 HAVING COUNT(*) > 1
      )
    `).get();

    const reclaimRow = db.prepare(`
      SELECT SUM(file_size) - (
        SELECT SUM(max_size) FROM (
          SELECT MAX(file_size) as max_size FROM photos 
          WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
          GROUP BY sha256 HAVING COUNT(*) > 1
        )
      ) as reclaimable FROM photos 
      WHERE is_deleted = 0 AND sha256 IN (
        SELECT sha256 FROM photos 
        WHERE is_deleted = 0 AND sha256 IS NOT NULL AND sha256 != ''
        GROUP BY sha256 HAVING COUNT(*) > 1
      )
    `).get();

    return {
      exactCount: exactRow ? (exactRow.exactCount || 0) : 0,
      similarCount: 0,
      reclaimableBytes: reclaimRow ? (reclaimRow.reclaimable || 0) : 0
    };
  } catch (e) {
    return { exactCount: 0, similarCount: 0, reclaimableBytes: 0 };
  }
}

module.exports = {
  db,
  stmts,
  queryPhotos,
  findDuplicates,
  cleanAllDuplicates,
  batchDeletePhotos,
  getDuplicateStats,
  CACHE_DIR,
  FACES_CACHE_DIR,
  DATA_DIR
};
