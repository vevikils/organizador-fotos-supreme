package com.example.organizadorfotossupreme

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ThumbnailUtils
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

class LocalApiRouter(
  private val context: Context,
  private val db: LocalDatabase,
  val scanner: LocalMediaScanner,
  val aiManager: LocalAiManager
) {

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
        val personId = uri.getQueryParameter("personId")?.toLongOrNull()
        val nsfw = uri.getQueryParameter("nsfw") == "nsfw_only"

        val photos = db.queryPhotos(limit, offset, category, favorites, query, personId, nsfw)
        return jsonResponse(photos.toString())
      }

      // 4. Categorías / Álbumes
      if (path == "/api/explore/categories" || path == "/api/albums") {
        val cats = db.getCategories()
        val res = JSONObject().apply { put("categories", cats) }
        return jsonResponse(res.toString())
      }

      // 5. Duplicados
      if (path.startsWith("/api/duplicates")) {
        val type = uri.getQueryParameter("tab") ?: "exact"
        val dups = db.getDuplicates(type)
        return jsonResponse(dups.toString())
      }

      // 6. Carpetas del Dispositivo
      if (path == "/api/folders") {
        val folders = db.getDeviceFolders()
        val res = JSONObject().apply { put("folders", folders) }
        return jsonResponse(res.toString())
      }

      if (path == "/api/folders/rescan" || path == "/api/scanner/start") {
        CoroutineScope(Dispatchers.Default).launch { scanner.scanDevicePhotos() }
        return jsonResponse("{\"success\":true}")
      }

      // 7. Personas & Caras (IA)
      if (path == "/api/faces/stats") {
        val stats = db.getFacesStats()
        return jsonResponse(stats.toString())
      }

      if (path == "/api/faces/persons") {
        val persons = db.getPersonsList()
        val res = JSONObject().apply { put("persons", persons) }
        return jsonResponse(res.toString())
      }

      if (path == "/api/faces/scan") {
        aiManager.startFaceScan()
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/faces/stop") {
        aiManager.stopFaceScan()
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/faces/status") {
        val status = aiManager.getFacesStatus()
        return jsonResponse(status.toString())
      }

      if (path.startsWith("/api/faces/persons/") && path.endsWith("/rename")) {
        val personId = path.removePrefix("/api/faces/persons/").removeSuffix("/rename").toLongOrNull()
        if (personId != null) {
          db.renamePerson(personId, "Persona $personId")
        }
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/faces/stream") {
        val status = aiManager.getFacesStatus()
        val sseData = "event: status\ndata: " + status.toString() + "\n\n"
        return WebResourceResponse("text/event-stream", "utf-8", ByteArrayInputStream(sseData.toByteArray()))
      }

      // 8. Contenido Sensible (IA)
      if (path == "/api/nsfw/stats") {
        val stats = db.getNsfwStats()
        return jsonResponse(stats.toString())
      }

      if (path == "/api/nsfw/scan") {
        aiManager.startNsfwScan()
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/nsfw/stop") {
        aiManager.stopNsfwScan()
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/nsfw/status") {
        val status = aiManager.getNsfwStatus()
        return jsonResponse(status.toString())
      }

      if (path.endsWith("/toggle-nsfw")) {
        val parts = path.split("/")
        val photoId = parts.getOrNull(3)?.toLongOrNull()
        if (photoId != null) {
          db.toggleNsfw(photoId)
        }
        return jsonResponse("{\"success\":true}")
      }

      if (path == "/api/nsfw/stream") {
        val status = aiManager.getNsfwStatus()
        val sseData = "event: status\ndata: " + status.toString() + "\n\n"
        return WebResourceResponse("text/event-stream", "utf-8", ByteArrayInputStream(sseData.toByteArray()))
      }

      // 9. Miniaturas
      if (path.startsWith("/api/photos/") && path.endsWith("/thumbnail")) {
        val parts = path.split("/")
        val id = parts.getOrNull(3)?.toLongOrNull() ?: return null
        val photo = db.getPhotoById(id) ?: return null
        val filePath = photo.optString("file_path")
        val file = File(filePath)
        if (!file.exists()) return null

        val thumb = ThumbnailUtils.extractThumbnail(
          BitmapFactory.decodeFile(file.absolutePath),
          256,
          256
        )

        val bos = ByteArrayOutputStream()
        thumb.compress(Bitmap.CompressFormat.JPEG, 75, bos)
        val bis = ByteArrayInputStream(bos.toByteArray())
        return WebResourceResponse("image/jpeg", null, bis)
      }

      // 10. Imagen RAW completa
      if (path.startsWith("/api/photos/") && path.endsWith("/raw")) {
        val parts = path.split("/")
        val id = parts.getOrNull(3)?.toLongOrNull() ?: return null
        val photo = db.getPhotoById(id) ?: return null
        val filePath = photo.optString("file_path")
        val file = File(filePath)
        if (!file.exists()) return null

        val mime = when {
          filePath.endsWith(".png", true) -> "image/png"
          filePath.endsWith(".webp", true) -> "image/webp"
          else -> "image/jpeg"
        }
        return WebResourceResponse(mime, null, FileInputStream(file))
      }

      // 11. Favorito toggle
      if (path.startsWith("/api/photos/") && path.endsWith("/favorite")) {
        val parts = path.split("/")
        val id = parts.getOrNull(3)?.toLongOrNull() ?: return null
        db.toggleFavorite(id)
        return jsonResponse("{\"success\":true}")
      }

      return jsonResponse("{\"success\":true}")
    } catch (e: Exception) {
      e.printStackTrace()
      return jsonResponse("{\"error\":\"${e.message}\"}")
    }
  }

  private fun jsonResponse(data: String): WebResourceResponse {
    val stream: InputStream = ByteArrayInputStream(data.toByteArray(Charsets.UTF_8))
    val headers = mapOf(
      "Access-Control-Allow-Origin" to "*",
      "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers" to "Content-Type"
    )
    return WebResourceResponse("application/json", "utf-8", 200, "OK", headers, stream)
  }
}
