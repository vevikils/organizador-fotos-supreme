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

class LocalDatabase(context: Context) : SQLiteOpenHelper(context, "photos_local.db", null, 1) {

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
        nsfw_checked INTEGER DEFAULT 0
      )
    """)

    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date_taken)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_fav ON photos(is_favorite)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_tiny ON photos(is_tiny)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_photos_del ON photos(is_deleted)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

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
    var totalPhotos = 0
    var favorites = 0
    var tinyCount = 0

    val c = db.rawQuery("""
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as favs,
        SUM(CASE WHEN is_tiny = 1 THEN 1 ELSE 0 END) as tinies
      FROM photos WHERE is_deleted = 0
    """, null)

    if (c.moveToFirst()) {
      totalPhotos = c.getInt(0)
      favorites = c.getInt(1)
      tinyCount = c.getInt(2)
    }
    c.close()

    val realPhotos = if (totalPhotos >= tinyCount) totalPhotos - tinyCount else totalPhotos

    res.put("total_photos", realPhotos)
    res.put("total_albums", getCategories().length())
    res.put("favorites_count", favorites)
    res.put("duplicates_count", getDuplicateStats().optInt("duplicate_photos", 0))
    res.put("tiny_count", tinyCount)

    return res
  }

  fun queryPhotos(
    limit: Int = 100,
    offset: Int = 0,
    category: String? = null,
    favoritesOnly: Boolean = false,
    query: String? = null
  ): JSONObject {
    val db = readableDatabase
    val whereClauses = mutableListOf("is_deleted = 0 AND is_tiny = 0")
    val args = mutableListOf<String>()

    if (!category.isNullOrEmpty() && category != "all") {
      whereClauses.add("category = ?")
      args.add(category)
    }

    if (favoritesOnly) {
      whereClauses.add("is_favorite = 1")
    }

    if (!query.isNullOrEmpty()) {
      whereClauses.add("(file_name LIKE ? OR category LIKE ?)")
      args.add("%$query%")
      args.add("%$query%")
    }

    val where = whereClauses.joinToString(" AND ")
    val countCursor = db.rawQuery("SELECT COUNT(*) FROM photos WHERE $where", args.toTypedArray())
    var total = 0
    if (countCursor.moveToFirst()) {
      total = countCursor.getInt(0)
    }
    countCursor.close()

    val photosArray = JSONArray()
    val cursor = db.rawQuery(
      "SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite, is_nsfw, nsfw_score FROM photos WHERE $where ORDER BY date_taken DESC LIMIT $limit OFFSET $offset",
      args.toTypedArray()
    )

    while (cursor.moveToNext()) {
      val item = JSONObject().apply {
        put("id", cursor.getLong(0))
        put("file_name", cursor.getString(1))
        put("file_path", cursor.getString(2))
        put("file_size", cursor.getLong(3))
        put("date_taken", cursor.getString(4))
        put("width", cursor.getInt(5))
        put("height", cursor.getInt(6))
        put("category", cursor.getString(7))
        put("is_favorite", cursor.getInt(8))
        put("is_nsfw", cursor.getInt(9))
        put("nsfw_score", cursor.getDouble(10))
        put("thumbnail_path", "/api/photos/${cursor.getLong(0)}/thumbnail")
      }
      photosArray.put(item)
    }
    cursor.close()

    return JSONObject().apply {
      put("photos", photosArray)
      put("total", total)
      put("page", (offset / limit) + 1)
      put("limit", limit)
      put("total_pages", if (total > 0) Math.ceil(total.toDouble() / limit).toInt() else 1)
    }
  }

  fun queryTimeline(): JSONObject {
    val db = readableDatabase
    val cursor = db.rawQuery("""
      SELECT id, file_name, file_path, file_size, date_taken, width, height, category, is_favorite, is_nsfw, nsfw_score
      FROM photos 
      WHERE is_deleted = 0 AND is_tiny = 0
      ORDER BY date_taken DESC
      LIMIT 1000
    """, null)

    val groupsMap = LinkedHashMap<String, JSONArray>()

    while (cursor.moveToNext()) {
      val id = cursor.getLong(0)
      val fileName = cursor.getString(1)
      val filePath = cursor.getString(2)
      val fileSize = cursor.getLong(3)
      val dateTaken = cursor.getString(4) ?: ""
      val width = cursor.getInt(5)
      val height = cursor.getInt(6)
      val category = cursor.getString(7)
      val isFav = cursor.getInt(8)
      val isNsfw = cursor.getInt(9)
      val nsfwScore = cursor.getDouble(10)

      val dateKey = if (dateTaken.length >= 10) dateTaken.substring(0, 10) else "Sin fecha"

      val group = groupsMap.getOrPut(dateKey) { JSONArray() }
      group.put(JSONObject().apply {
        put("id", id)
        put("file_name", fileName)
        put("file_path", filePath)
        put("file_size", fileSize)
        put("date_taken", dateTaken)
        put("width", width)
        put("height", height)
        put("category", category)
        put("is_favorite", isFav)
        put("is_nsfw", isNsfw)
        put("nsfw_score", nsfwScore)
        put("thumbnail_path", "/api/photos/$id/thumbnail")
      })
    }
    cursor.close()

    val groupsArray = JSONArray()
    for ((dateKey, photos) in groupsMap) {
      groupsArray.put(JSONObject().apply {
        put("date", dateKey)
        put("count", photos.length())
        put("photos", photos)
      })
    }

    return JSONObject().apply {
      put("groups", groupsArray)
    }
  }

  fun getCategories(): JSONArray {
    val db = readableDatabase
    val cursor = db.rawQuery("""
      SELECT category, COUNT(*) as count, MIN(id) as sample_id
      FROM photos 
      WHERE is_deleted = 0 AND is_tiny = 0
      GROUP BY category
      ORDER BY count DESC
    """, null)

    val res = JSONArray()
    while (cursor.moveToNext()) {
      res.put(JSONObject().apply {
        put("category", cursor.getString(0))
        put("count", cursor.getInt(1))
        put("sample_photo_id", cursor.getLong(2))
      })
    }
    cursor.close()
    return res
  }

  fun getPhotoById(id: Long): JSONObject? {
    val db = readableDatabase
    val cursor = db.rawQuery("SELECT * FROM photos WHERE id = ?", arrayOf(id.toString()))
    if (cursor.moveToFirst()) {
      val res = JSONObject().apply {
        put("id", cursor.getLong(cursor.getColumnIndexOrThrow("id")))
        put("file_name", cursor.getString(cursor.getColumnIndexOrThrow("file_name")))
        put("file_path", cursor.getString(cursor.getColumnIndexOrThrow("file_path")))
        put("file_size", cursor.getLong(cursor.getColumnIndexOrThrow("file_size")))
        put("date_taken", cursor.getString(cursor.getColumnIndexOrThrow("date_taken")))
        put("width", cursor.getInt(cursor.getColumnIndexOrThrow("width")))
        put("height", cursor.getInt(cursor.getColumnIndexOrThrow("height")))
        put("category", cursor.getString(cursor.getColumnIndexOrThrow("category")))
        put("is_favorite", cursor.getInt(cursor.getColumnIndexOrThrow("is_favorite")))
        put("is_nsfw", cursor.getInt(cursor.getColumnIndexOrThrow("is_nsfw")))
        put("nsfw_score", cursor.getDouble(cursor.getColumnIndexOrThrow("nsfw_score")))
        put("thumbnail_path", "/api/photos/$id/thumbnail")
      }
      cursor.close()
      return res
    }
    cursor.close()
    return null
  }

  fun toggleFavorite(id: Long): Boolean {
    val db = writableDatabase
    db.execSQL("UPDATE photos SET is_favorite = (1 - is_favorite) WHERE id = ?", arrayOf(id.toString()))
    return true
  }

  fun deletePhoto(id: Long): Boolean {
    val db = writableDatabase
    db.execSQL("UPDATE photos SET is_deleted = 1 WHERE id = ?", arrayOf(id.toString()))
    return true
  }

  fun getDuplicateStats(): JSONObject {
    val db = readableDatabase
    val cursor = db.rawQuery("""
      SELECT COUNT(*) - COUNT(DISTINCT file_size) as dupes,
             SUM(file_size) as wasted
      FROM photos 
      WHERE is_deleted = 0 AND is_tiny = 0 AND file_size >= 1024
      GROUP BY file_size
      HAVING COUNT(*) > 1
    """, null)

    var dupCount = 0
    var wastedBytes: Long = 0

    while (cursor.moveToNext()) {
      dupCount += cursor.getInt(0)
      wastedBytes += cursor.getLong(1)
    }
    cursor.close()

    return JSONObject().apply {
      put("duplicate_groups", dupCount)
      put("duplicate_photos", dupCount)
      put("wasted_space_bytes", wastedBytes)
      put("wasted_space_mb", wastedBytes / (1024 * 1024))
    }
  }

  fun getDuplicates(type: String = "exact"): JSONObject {
    val db = readableDatabase
    val cursor = db.rawQuery("""
      SELECT file_size, COUNT(*) as cnt
      FROM photos 
      WHERE is_deleted = 0 AND is_tiny = 0 AND file_size >= 1024
      GROUP BY file_size
      HAVING cnt > 1
      ORDER BY file_size DESC
      LIMIT 100
    """, null)

    val groups = JSONArray()

    while (cursor.moveToNext()) {
      val size = cursor.getLong(0)
      val groupCursor = db.rawQuery("""
        SELECT id, file_name, file_path, file_size, date_taken, width, height, category
        FROM photos 
        WHERE file_size = ? AND is_deleted = 0 AND is_tiny = 0
        ORDER BY date_taken ASC
      """, arrayOf(size.toString()))

      val photosInGroup = JSONArray()
      while (groupCursor.moveToNext()) {
        val pid = groupCursor.getLong(0)
        photosInGroup.put(JSONObject().apply {
          put("id", pid)
          put("file_name", groupCursor.getString(1))
          put("file_path", groupCursor.getString(2))
          put("file_size", groupCursor.getLong(3))
          put("date_taken", groupCursor.getString(4))
          put("width", groupCursor.getInt(5))
          put("height", groupCursor.getInt(6))
          put("category", groupCursor.getString(7))
          put("thumbnail_path", "/api/photos/$pid/thumbnail")
        })
      }
      groupCursor.close()

      if (photosInGroup.length() > 1) {
        groups.put(JSONObject().apply {
          put("group_id", size.toString())
          put("hash", size.toString())
          put("file_size", size)
          put("photos", photosInGroup)
        })
      }
    }
    cursor.close()

    return JSONObject().apply {
      put("groups", groups)
      put("stats", getDuplicateStats())
    }
  }
}
