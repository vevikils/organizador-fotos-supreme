package com.example.organizadorfotossupreme

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class LocalDatabase(context: Context) : SQLiteOpenHelper(context, "photos_local.db", null, 2) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        file_path TEXT UNIQUE NOT NULL,
        file_size INTEGER DEFAULT 0,
        date_taken TEXT,
        created_at TEXT,
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        category TEXT DEFAULT 'Cámara',
        is_favorite INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        is_tiny INTEGER DEFAULT 0,
        dhash TEXT,
        sha256 TEXT,
        is_nsfw INTEGER DEFAULT 0,
        nsfw_score REAL DEFAULT 0.0,
        nsfw_checked INTEGER DEFAULT 0,
        faces_scanned INTEGER DEFAULT 0
      )
    """)

    db.execSQL("""
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sample_photo_id INTEGER,
        face_count INTEGER DEFAULT 0,
        created_at TEXT
      )
    """)

    db.execSQL("""
      CREATE TABLE IF NOT EXISTS faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id INTEGER NOT NULL,
        person_id INTEGER,
        confidence REAL DEFAULT 1.0,
        box_x REAL DEFAULT 0,
        box_y REAL DEFAULT 0,
        box_w REAL DEFAULT 0,
        box_h REAL DEFAULT 0
      )
    """)

    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date_taken)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_fav ON photos(is_favorite)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_tiny ON photos(is_tiny)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_del ON photos(is_deleted)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sample_photo_id INTEGER,
        face_count INTEGER DEFAULT 0,
        created_at TEXT
      )
    """)

    db.execSQL("""
      CREATE TABLE IF NOT EXISTS faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id INTEGER NOT NULL,
        person_id INTEGER,
        confidence REAL DEFAULT 1.0,
        box_x REAL DEFAULT 0,
        box_y REAL DEFAULT 0,
        box_w REAL DEFAULT 0,
        box_h REAL DEFAULT 0
      )
    """)

    db.execSQL("CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id)")
  }

  override fun onOpen(db: SQLiteDatabase) {
    super.onOpen(db)
    try {
      db.execSQL("ALTER TABLE photos ADD COLUMN faces_scanned INTEGER DEFAULT 0")
    } catch (e: Exception) {}
    try {
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_faces_scanned ON photos(faces_scanned)")
    } catch (e: Exception) {}
    try {
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_nsfw_checked ON photos(nsfw_checked)")
    } catch (e: Exception) {}
  }

  fun insertOrUpdatePhoto(
    fileName: String,
    filePath: String,
    fileSize: Long,
    dateTaken: String?,
    width: Int,
    height: Int,
    category: String
  ): Long {
    val db = writableDatabase
    val isTiny = if (fileSize < 1024 || (width in 1..48 && height in 1..48)) 1 else 0

    val cv = ContentValues().apply {
      put("file_name", fileName)
      put("file_path", filePath)
      put("file_size", fileSize)
      put("date_taken", dateTaken ?: SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
      put("created_at", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
      put("width", width)
      put("height", height)
      put("category", category)
      put("is_tiny", isTiny)
    }

    return db.insertWithOnConflict("photos", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
  }

  fun getStats(): JSONObject {
    val db = readableDatabase
    val res = JSONObject()

    val cursor = db.rawQuery(
      "SELECT COUNT(*) as total, COALESCE(SUM(file_size), 0) as total_size FROM photos WHERE is_deleted = 0 AND is_tiny = 0",
      null
    )
    if (cursor.moveToFirst()) {
      res.put("total_photos", cursor.getInt(0))
      res.put("total_size", cursor.getLong(1))
    }
    cursor.close()

    val favCursor = db.rawQuery("SELECT COUNT(*) FROM photos WHERE is_favorite = 1 AND is_deleted = 0", null)
    if (favCursor.moveToFirst()) {
      res.put("total_favorites", favCursor.getInt(0))
    }
    favCursor.close()

    res.put("total_albums", 0)
    res.put("total_people", getPeopleCount())
    return res
  }

  fun queryTimeline(): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()

    val cursor = db.rawQuery("""
      SELECT 
        date(date_taken) as day_date,
        COUNT(*) as count
      FROM photos 
      WHERE is_deleted = 0 AND is_tiny = 0 AND date_taken IS NOT NULL
      GROUP BY date(date_taken)
      ORDER BY date(date_taken) DESC
      LIMIT 60
    """, null)

    while (cursor.moveToNext()) {
      val day = cursor.getString(0) ?: continue
      val count = cursor.getInt(1)

      val photosCur = db.rawQuery("""
        SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite, is_nsfw, nsfw_score
        FROM photos
        WHERE is_deleted = 0 AND is_tiny = 0 AND date(date_taken) = ?
        ORDER BY date_taken DESC
      """, arrayOf(day))

      val photosArr = JSONArray()
      while (photosCur.moveToNext()) {
        photosArr.put(cursorToPhoto(photosCur))
      }
      photosCur.close()

      val group = JSONObject().apply {
        put("date", day)
        put("title", formatDayTitle(day))
        put("count", count)
        put("photos", photosArr)
      }
      arr.put(group)
    }
    cursor.close()
    return arr
  }

  private fun formatDayTitle(dayStr: String): String {
    return try {
      val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
      val date = sdf.parse(dayStr) ?: return dayStr
      val today = Calendar.getInstance()
      val cal = Calendar.getInstance().apply { time = date }

      if (today.get(Calendar.YEAR) == cal.get(Calendar.YEAR) &&
        today.get(Calendar.DAY_OF_YEAR) == cal.get(Calendar.DAY_OF_YEAR)
      ) {
        return "Hoy"
      }

      val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
      if (yesterday.get(Calendar.YEAR) == cal.get(Calendar.YEAR) &&
        yesterday.get(Calendar.DAY_OF_YEAR) == cal.get(Calendar.DAY_OF_YEAR)
      ) {
        return "Ayer"
      }

      val outSdf = SimpleDateFormat("EEEE, d 'de' MMMM 'de' yyyy", Locale("es", "ES"))
      outSdf.format(date).replaceFirstChar { it.uppercase() }
    } catch (e: Exception) {
      dayStr
    }
  }

  fun queryPhotos(
    limit: Int = 100,
    offset: Int = 0,
    category: String? = null,
    favoritesOnly: Boolean = false,
    query: String? = null,
    personId: Long? = null,
    nsfwOnly: Boolean = false
  ): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()

    val whereClauses = mutableListOf("is_deleted = 0", "is_tiny = 0")
    val args = mutableListOf<String>()

    if (favoritesOnly) {
      whereClauses.add("is_favorite = 1")
    }
    if (!category.isNullOrEmpty()) {
      whereClauses.add("category = ?")
      args.add(category)
    }
    if (!query.isNullOrEmpty()) {
      whereClauses.add("(file_name LIKE ? OR category LIKE ?)")
      args.add("%$query%")
      args.add("%$query%")
    }
    if (personId != null) {
      whereClauses.add("id IN (SELECT photo_id FROM faces WHERE person_id = ?)")
      args.add(personId.toString())
    }
    if (nsfwOnly) {
      whereClauses.add("is_nsfw = 1")
    }

    val sql = "SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite, is_nsfw, nsfw_score FROM photos WHERE ${whereClauses.joinToString(" AND ")} ORDER BY date_taken DESC LIMIT $limit OFFSET $offset"

    val cursor = db.rawQuery(sql, args.toTypedArray())
    while (cursor.moveToNext()) {
      arr.put(cursorToPhoto(cursor))
    }
    cursor.close()
    return arr
  }

  fun getPhotoById(id: Long): JSONObject? {
    val db = readableDatabase
    val cursor = db.rawQuery(
      "SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite, is_nsfw, nsfw_score FROM photos WHERE id = ?",
      arrayOf(id.toString())
    )
    var photo: JSONObject? = null
    if (cursor.moveToFirst()) {
      photo = cursorToPhoto(cursor)
    }
    cursor.close()
    return photo
  }

  fun toggleFavorite(id: Long): Boolean {
    val db = writableDatabase
    db.execSQL("UPDATE photos SET is_favorite = 1 - is_favorite WHERE id = ?", arrayOf(id.toString()))
    return true
  }

  fun getCategories(): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()
    val cursor = db.rawQuery("""
      SELECT category, COUNT(*) as count, MIN(id) as sample_id
      FROM photos
      WHERE is_deleted = 0 AND is_tiny = 0
      GROUP BY category
      ORDER BY count DESC
    """, null)

    while (cursor.moveToNext()) {
      val cat = JSONObject().apply {
        put("category", cursor.getString(0))
        put("name", cursor.getString(0))
        put("count", cursor.getInt(1))
        put("sample_photo_id", cursor.getLong(2))
      }
      arr.put(cat)
    }
    cursor.close()
    return arr
  }

  fun getDeviceFolders(): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()
    val cursor = db.rawQuery("""
      SELECT category, COUNT(*) as count, MIN(id) as sample_id
      FROM photos
      WHERE is_deleted = 0 AND is_tiny = 0
      GROUP BY category
      ORDER BY count DESC
    """, null)

    var folderId = 1
    while (cursor.moveToNext()) {
      val catName = cursor.getString(0) ?: "Otros"
      val count = cursor.getInt(1)
      val sampleId = cursor.getLong(2)

      val icon = when {
        catName.contains("Cámara", ignoreCase = true) -> "photo_camera"
        catName.contains("WhatsApp", ignoreCase = true) -> "chat"
        catName.contains("Descargas", ignoreCase = true) || catName.contains("Download", ignoreCase = true) -> "download"
        catName.contains("Capturas", ignoreCase = true) || catName.contains("Screenshot", ignoreCase = true) -> "screenshot"
        else -> "folder"
      }

      val f = JSONObject().apply {
        put("id", folderId++)
        put("name", catName)
        put("path", catName)
        put("photo_count", count)
        put("sample_photo_id", sampleId)
        put("icon", icon)
        put("last_scanned", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
      }
      arr.put(f)
    }
    cursor.close()
    return arr
  }

  fun getDuplicates(type: String): JSONObject {
    val db = readableDatabase
    val res = JSONObject()
    val groups = JSONArray()

    val cursor = db.rawQuery("""
      SELECT file_size, COUNT(*) as count
      FROM photos
      WHERE is_deleted = 0 AND is_tiny = 0
      GROUP BY file_size
      HAVING count > 1
      ORDER BY file_size DESC
      LIMIT 30
    """, null)

    var reclaimedBytes = 0L
    var groupIndex = 1

    while (cursor.moveToNext()) {
      val size = cursor.getLong(0)
      val count = cursor.getInt(1)
      reclaimedBytes += (size * (count - 1))

      val pCur = db.rawQuery(
        "SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite FROM photos WHERE file_size = ? AND is_deleted = 0 AND is_tiny = 0 LIMIT 6",
        arrayOf(size.toString())
      )

      val photosArr = JSONArray()
      while (pCur.moveToNext()) {
        photosArr.put(cursorToPhoto(pCur))
      }
      pCur.close()

      val g = JSONObject().apply {
        put("group_id", groupIndex++)
        put("match_type", "exact_size")
        put("file_size", size)
        put("count", count)
        put("photos", photosArr)
      }
      groups.put(g)
    }
    cursor.close()

    res.put("groups", groups)
    res.put("total_groups", groups.length())
    res.put("potential_reclaim_bytes", reclaimedBytes)
    return res
  }

  // --- AI People & Faces Methods ---
  fun getUnprocessedFacesPhotos(): List<JSONObject> {
    val db = readableDatabase
    val list = mutableListOf<JSONObject>()
    val cursor = db.rawQuery(
      "SELECT id, file_path, file_name FROM photos WHERE is_deleted = 0 AND is_tiny = 0 AND faces_scanned = 0",
      null
    )
    while (cursor.moveToNext()) {
      list.add(JSONObject().apply {
        put("id", cursor.getLong(0))
        put("file_path", cursor.getString(1))
        put("file_name", cursor.getString(2))
      })
    }
    cursor.close()
    return list
  }

  fun getPeopleCount(): Int {
    val db = readableDatabase
    val cursor = db.rawQuery("SELECT COUNT(*) FROM people", null)
    var count = 0
    if (cursor.moveToFirst()) count = cursor.getInt(0)
    cursor.close()
    return count
  }

  fun findOrCreatePerson(name: String, samplePhotoId: Long): Long {
    val db = writableDatabase
    val cv = ContentValues().apply {
      put("name", name)
      put("sample_photo_id", samplePhotoId)
      put("face_count", 1)
      put("created_at", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
    }
    return db.insert("people", null, cv)
  }

  fun recordFace(photoId: Long, personId: Long, confidence: Double) {
    val db = writableDatabase
    val cv = ContentValues().apply {
      put("photo_id", photoId)
      put("person_id", personId)
      put("confidence", confidence)
    }
    db.insert("faces", null, cv)
    db.execSQL("UPDATE people SET face_count = face_count + 1 WHERE id = ?", arrayOf(personId.toString()))
  }

    fun markFaceScanned(photoId: Long) {
    val db = writableDatabase
    db.execSQL("UPDATE photos SET faces_scanned = 1 WHERE id = ?", arrayOf(photoId.toString()))
  }

  fun getFacesStats(): JSONObject {
    val db = readableDatabase
    val res = JSONObject()
    val stats = JSONObject()

    val pCursor = db.rawQuery("SELECT COUNT(*) FROM people", null)
    var people = 0
    if (pCursor.moveToFirst()) people = pCursor.getInt(0)
    pCursor.close()

    val fCursor = db.rawQuery("SELECT COUNT(*) FROM faces", null)
    var faces = 0
    if (fCursor.moveToFirst()) faces = fCursor.getInt(0)
    fCursor.close()

    val uCursor = db.rawQuery(
      "SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_tiny = 0 AND faces_scanned = 0",
      null
    )
    var unclassified = 0
    if (uCursor.moveToFirst()) unclassified = uCursor.getInt(0)
    uCursor.close()

    stats.put("total_persons", people)
    stats.put("total_faces", faces)
    stats.put("unscanned_photos", unclassified)
    res.put("stats", stats)
    return res
  }

  fun getPersonsList(): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()
    val cursor = db.rawQuery(
      "SELECT id, name, sample_photo_id, face_count FROM people ORDER BY face_count DESC LIMIT 100",
      null
    )
    while (cursor.moveToNext()) {
      val p = JSONObject().apply {
        put("id", cursor.getLong(0))
        put("name", cursor.getString(1))
        put("sample_photo_id", cursor.getLong(2))
        put("photo_count", cursor.getInt(3))
        put("cover_crop_path", "")
      }
      arr.put(p)
    }
    cursor.close()
    return arr
  }

  fun renamePerson(personId: Long, newName: String): Boolean {
    val db = writableDatabase
    val cv = ContentValues().apply { put("name", newName) }
    db.update("people", cv, "id = ?", arrayOf(personId.toString()))
    return true
  }

  fun getPersonPhotos(personId: Long): JSONArray {
    val db = readableDatabase
    val arr = JSONArray()
    val cursor = db.rawQuery("""
      SELECT p.id, p.file_name, p.file_path, p.file_size, p.date_taken, p.width, p.height, p.category, p.is_favorite, p.is_nsfw, p.nsfw_score
      FROM photos p
      INNER JOIN faces f ON p.id = f.photo_id
      WHERE f.person_id = ? AND p.is_deleted = 0
      ORDER BY p.date_taken DESC
    """, arrayOf(personId.toString()))

    while (cursor.moveToNext()) {
      arr.put(cursorToPhoto(cursor))
    }
    cursor.close()
    return arr
  }

  // --- AI NSFW Methods ---
  fun getUncheckedNsfwPhotos(): List<JSONObject> {
    val db = readableDatabase
    val list = mutableListOf<JSONObject>()
    val cursor = db.rawQuery(
      "SELECT id, file_path, file_name FROM photos WHERE is_deleted = 0 AND is_tiny = 0 AND nsfw_checked = 0",
      null
    )
    while (cursor.moveToNext()) {
      list.add(JSONObject().apply {
        put("id", cursor.getLong(0))
        put("file_path", cursor.getString(1))
        put("file_name", cursor.getString(2))
      })
    }
    cursor.close()
    return list
  }

  fun updateNsfw(photoId: Long, isNsfw: Int, score: Double) {
    val db = writableDatabase
    val cv = ContentValues().apply {
      put("is_nsfw", isNsfw)
      put("nsfw_score", score)
      put("nsfw_checked", 1)
    }
    db.update("photos", cv, "id = ?", arrayOf(photoId.toString()))
  }

  fun toggleNsfw(photoId: Long): Boolean {
    val db = writableDatabase
    db.execSQL("UPDATE photos SET is_nsfw = 1 - is_nsfw WHERE id = ?", arrayOf(photoId.toString()))
    return true
  }

  fun getNsfwStats(): JSONObject {
    val db = readableDatabase
    val res = JSONObject()
    val stats = JSONObject()

    val cCur = db.rawQuery("SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND nsfw_checked = 1", null)
    var checked = 0
    if (cCur.moveToFirst()) checked = cCur.getInt(0)
    cCur.close()

    val nCur = db.rawQuery("SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_nsfw = 1", null)
    var nsfw = 0
    if (nCur.moveToFirst()) nsfw = nCur.getInt(0)
    nCur.close()

    val uCur = db.rawQuery("SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_tiny = 0 AND nsfw_checked = 0", null)
    var unclassified = 0
    if (uCur.moveToFirst()) unclassified = uCur.getInt(0)
    uCur.close()

    stats.put("total_checked", checked)
    stats.put("nsfw_photos", nsfw)
    stats.put("sfw_photos", if (checked >= nsfw) checked - nsfw else 0)
    stats.put("unclassified_photos", unclassified)
    res.put("stats", stats)
    return res
  }

  private fun cursorToPhoto(cursor: android.database.Cursor): JSONObject {
    return JSONObject().apply {
      put("id", cursor.getLong(0))
      put("file_name", cursor.getString(1))
      put("file_path", cursor.getString(2))
      put("file_size", cursor.getLong(3))
      put("date_taken", cursor.getString(4))
      put("width", cursor.getInt(5))
      put("height", cursor.getInt(6))
      put("category", cursor.getString(7))
      put("is_favorite", cursor.getInt(8))
      if (cursor.columnCount > 9) {
        put("is_nsfw", cursor.getInt(9))
        put("nsfw_score", cursor.getDouble(10))
      }
    }
  }
}
