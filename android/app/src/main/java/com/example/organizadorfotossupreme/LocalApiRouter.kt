package com.example.organizadorfotossupreme

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ThumbnailUtils
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

class LocalApiRouter(private val context: Context, private val db: LocalDatabase, val scanner: LocalMediaScanner) {

  fun handle(url: String, request: WebResourceRequest): WebResourceResponse? {
    try {
      val uri = Uri.parse(url)
      val path = uri.path ?: ""

      // 1. Estadísticas
      if (path == "/api/stats") {
        val stats = db.getStats()
        return jsonResponse(stats.toString())
      }

      // 2. Línea de tiempo
      if (path == "/api/photos/timeline") {
        val timeline = db.queryTimeline()
        return jsonResponse(timeline.toString())
      }

      // 3. Consulta de fotos
      if (path == "/api/photos") {
        val limit = uri.getQueryParameter("limit")?.toIntOrNull() ?: 100
        val page = uri.getQueryParameter("page")?.toIntOrNull() ?: 1
        val offset = (page - 1) * limit
        val category = uri.getQueryParameter("category")
        val favorites = uri.getQueryParameter("favorites") == "true"
        val query = uri.getQueryParameter("q") ?: uri.getQueryParameter("query")

        val photos = db.queryPhotos(limit, offset, category, favorites, query)
        return jsonResponse(photos.toString())
      }

      // 4. Categorías / Álbumes
      if (path == "/api/explore/categories") {
        val cats = db.getCategories()
        val res = JSONObject().apply { put("categories", cats) }
        return jsonResponse(res.toString())
      }

      if (path == "/api/albums") {
        val cats = db.getCategories()
        return jsonResponse(cats.toString())
      }

      // 5. Duplicados
      if (path.startsWith("/api/duplicates")) {
        val type = uri.getQueryParameter("tab") ?: "exact"
        val dups = db.getDuplicates(type)
        return jsonResponse(dups.toString())
      }

      // 6. Escáner
      if (path == "/api/scanner/start") {
        return jsonResponse(JSONObject().apply {
          put("success", true)
          put("message", "Escaneo iniciado")
        }.toString())
      }

      if (path == "/api/scanner/status") {
        return jsonResponse(JSONObject().apply {
          put("isScanning", scanner.isScanning)
          put("processed", scanner.processed)
          put("total", scanner.totalFound)
          put("currentFile", scanner.currentFile)
        }.toString())
      }

      // 7. Miniatura de foto (/api/photos/:id/thumbnail)
      val thumbMatch = Regex("""/api/photos/(\d+)/thumbnail""").find(path)
      if (thumbMatch != null) {
        val photoId = thumbMatch.groupValues[1].toLongOrNull() ?: return null
        return getPhotoThumbnail(photoId)
      }

      // 8. Foto original (/api/photos/:id/raw)
      val rawMatch = Regex("""/api/photos/(\d+)/raw""").find(path)
      if (rawMatch != null) {
        val photoId = rawMatch.groupValues[1].toLongOrNull() ?: return null
        return getPhotoRaw(photoId)
      }

      // 9. Detalle de foto (/api/photos/:id)
      val photoMatch = Regex("""/api/photos/(\d+)""").find(path)
      if (photoMatch != null) {
        val photoId = photoMatch.groupValues[1].toLongOrNull() ?: return null
        if (request.method == "DELETE") {
          db.deletePhoto(photoId)
          return jsonResponse(JSONObject().apply { put("success", true) }.toString())
        }
        val photo = db.getPhotoById(photoId)
        if (photo != null) {
          return jsonResponse(photo.toString())
        }
      }

      // 10. Favorito (/api/photos/:id/favorite)
      val favMatch = Regex("""/api/photos/(\d+)/favorite""").find(path)
      if (favMatch != null) {
        val photoId = favMatch.groupValues[1].toLongOrNull() ?: return null
        db.toggleFavorite(photoId)
        val photo = db.getPhotoById(photoId)
        return jsonResponse(JSONObject().apply {
          put("success", true)
          put("photo", photo)
        }.toString())
      }

      // 11. Info del servidor local
      if (path == "/api/server-info") {
        val stats = db.getStats()
        return jsonResponse(JSONObject().apply {
          put("status", "ok")
          put("mode", "local_android")
          put("app", "Fotos Supreme Móvil")
          put("total_photos", stats.optInt("total_photos", 0))
        }.toString())
      }

      return jsonResponse(JSONObject().apply { put("success", true) }.toString())

    } catch (e: Exception) {
      return jsonResponse(JSONObject().apply {
        put("error", e.message ?: "Error interno")
      }.toString(), statusCode = 500)
    }
  }

  private fun getPhotoThumbnail(photoId: Long): WebResourceResponse? {
    val cacheDir = File(context.cacheDir, "thumbnails")
    if (!cacheDir.exists()) cacheDir.mkdirs()
    val cacheFile = File(cacheDir, "$photoId.jpg")

    if (cacheFile.exists() && cacheFile.length() > 0) {
      return WebResourceResponse("image/jpeg", null, FileInputStream(cacheFile))
    }

    val photo = db.getPhotoById(photoId) ?: return null
    val filePath = photo.optString("file_path", "")
    if (filePath.isEmpty()) return null

    try {
      val file = File(filePath)
      val bitmap: Bitmap? = if (file.exists()) {
        val options = BitmapFactory.Options().apply {
          inJustDecodeBounds = true
        }
        BitmapFactory.decodeFile(filePath, options)

        val targetSize = 250
        var sample = 1
        while (options.outWidth / (sample * 2) >= targetSize && options.outHeight / (sample * 2) >= targetSize) {
          sample *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply {
          inSampleSize = sample
          inPreferredConfig = Bitmap.Config.RGB_565
        }
        BitmapFactory.decodeFile(filePath, decodeOptions)
      } else {
        null
      }

      if (bitmap != null) {
        val outStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 75, outStream)
        val bytes = outStream.toByteArray()

        try {
          cacheFile.writeBytes(bytes)
        } catch (e: Exception) {}

        bitmap.recycle()
        return WebResourceResponse("image/jpeg", null, ByteArrayInputStream(bytes))
      }
    } catch (e: Exception) {}

    return null
  }

  private fun getPhotoRaw(photoId: Long): WebResourceResponse? {
    val photo = db.getPhotoById(photoId) ?: return null
    val filePath = photo.optString("file_path", "")
    if (filePath.isEmpty()) return null

    val file = File(filePath)
    if (file.exists()) {
      val mime = when (file.extension.lowercase()) {
        "png" -> "image/png"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        else -> "image/jpeg"
      }
      return WebResourceResponse(mime, null, FileInputStream(file))
    }
    return null
  }

  private fun jsonResponse(json: String, statusCode: Int = 200): WebResourceResponse {
    val bytes = json.toByteArray(Charsets.UTF_8)
    val stream = ByteArrayInputStream(bytes)
    val headers = mapOf(
      "Access-Control-Allow-Origin" to "*",
      "Content-Type" to "application/json; charset=utf-8"
    )
    return WebResourceResponse("application/json", "utf-8", statusCode, "OK", headers, stream)
  }
}
