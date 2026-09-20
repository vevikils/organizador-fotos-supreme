package com.example.organizadorfotossupreme

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.FaceDetector
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import kotlin.math.abs

class LocalAiManager(private val context: Context, private val db: LocalDatabase) {
  private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

  // --- Face Scanning State ---
  var isFaceScanning = false
    private set
  var faceScanTotal = 0
  var faceScanProcessed = 0
  var facesFoundCount = 0
  var peopleCount = 0
  private var faceScanJob: Job? = null

  // --- NSFW Scanning State ---
  var isNsfwScanning = false
    private set
  var nsfwScanTotal = 0
  var nsfwScanProcessed = 0
  var nsfwFoundCount = 0
  private var nsfwScanJob: Job? = null

  fun getFacesStatus(): JSONObject {
    return JSONObject().apply {
      put("isScanning", isFaceScanning)
      put("current", JSONObject().apply {
        put("total", faceScanTotal)
        put("processed", faceScanProcessed)
        put("faces", facesFoundCount)
        put("people", peopleCount)
        val pct = if (faceScanTotal > 0) (faceScanProcessed * 100) / faceScanTotal else 0
        put("percentage", pct)
      })
    }
  }

  fun getNsfwStatus(): JSONObject {
    return JSONObject().apply {
      put("isScanning", isNsfwScanning)
      put("current", JSONObject().apply {
        put("total", nsfwScanTotal)
        put("processed", nsfwScanProcessed)
        put("nsfwTotal", nsfwFoundCount)
        val pct = if (nsfwScanTotal > 0) (nsfwScanProcessed * 100) / nsfwScanTotal else 0
        put("percentage", pct)
      })
    }
  }

  fun startFaceScan(onProgress: ((processed: Int, total: Int, faces: Int, people: Int) -> Unit)? = null) {
    if (isFaceScanning) return
    isFaceScanning = true

    faceScanJob = scope.launch {
      try {
        val photos = db.getUnprocessedFacesPhotos()
        faceScanTotal = photos.size
        faceScanProcessed = 0
        facesFoundCount = 0

        for (photo in photos) {
          if (!isFaceScanning) break

          val id = photo.optLong("id")
          val path = photo.optString("file_path")

          if (File(path).exists()) {
            val numFaces = detectFacesInPhoto(path)
            if (numFaces > 0) {
              facesFoundCount += numFaces
              val currentPeople = db.getPeopleCount()
              val personName = "Persona " + (currentPeople + 1)
              val personId = db.findOrCreatePerson(personName, id)
              db.recordFace(id, personId, 0.95)
            }
          }

          db.markFaceScanned(id)
          faceScanProcessed++
          peopleCount = db.getPeopleCount()
          onProgress?.invoke(faceScanProcessed, faceScanTotal, facesFoundCount, peopleCount)

          if (faceScanProcessed % 5 == 0) {
            delay(15)
          }
        }
      } catch (e: Exception) {
        e.printStackTrace()
      } finally {
        isFaceScanning = false
        peopleCount = db.getPeopleCount()
        onProgress?.invoke(faceScanProcessed, faceScanTotal, facesFoundCount, peopleCount)
      }
    }
  }

  fun stopFaceScan() {
    isFaceScanning = false
    faceScanJob?.cancel()
  }

  private fun detectFacesInPhoto(path: String): Int {
    return try {
      val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, boundsOptions)
      val w = boundsOptions.outWidth
      val h = boundsOptions.outHeight
      if (w <= 0 || h <= 0) return 0

      val targetW = 320
      val targetH = 240
      var sampleSize = 1
      while (w / (sampleSize * 2) >= targetW && h / (sampleSize * 2) >= targetH) {
        sampleSize *= 2
      }

      val decodeOptions = BitmapFactory.Options().apply {
        inSampleSize = sampleSize
        inPreferredConfig = Bitmap.Config.RGB_565
      }

      val bmp = BitmapFactory.decodeFile(path, decodeOptions) ?: return 0
      val evenW = if (bmp.width % 2 != 0) bmp.width - 1 else bmp.width
      val workBmp = if (bmp.width != evenW) Bitmap.createBitmap(bmp, 0, 0, evenW, bmp.height) else bmp

      val maxFaces = 5
      val faces = arrayOfNulls<FaceDetector.Face>(maxFaces)
      val detector = FaceDetector(workBmp.width, workBmp.height, maxFaces)
      val numFaces = detector.findFaces(workBmp, faces)

      if (workBmp != bmp) workBmp.recycle()
      bmp.recycle()
      numFaces
    } catch (e: Exception) {
      0
    }
  }

  fun startNsfwScan(onProgress: ((processed: Int, total: Int, nsfw: Int) -> Unit)? = null) {
    if (isNsfwScanning) return
    isNsfwScanning = true

    nsfwScanJob = scope.launch {
      try {
        val photos = db.getUncheckedNsfwPhotos()
        nsfwScanTotal = photos.size
        nsfwScanProcessed = 0
        nsfwFoundCount = 0

        for (photo in photos) {
          if (!isNsfwScanning) break

          val id = photo.optLong("id")
          val path = photo.optString("file_path")

          var isNsfw = false
          var score = 0.0

          if (File(path).exists()) {
            val result = analyzeNsfwHeuristics(path)
            isNsfw = result.first
            score = result.second
          }

          db.updateNsfw(id, if (isNsfw) 1 else 0, score)
          if (isNsfw) nsfwFoundCount++

          nsfwScanProcessed++
          onProgress?.invoke(nsfwScanProcessed, nsfwScanTotal, nsfwFoundCount)

          if (nsfwScanProcessed % 5 == 0) {
            delay(15)
          }
        }
      } catch (e: Exception) {
        e.printStackTrace()
      } finally {
        isNsfwScanning = false
        onProgress?.invoke(nsfwScanProcessed, nsfwScanTotal, nsfwFoundCount)
      }
    }
  }

  fun stopNsfwScan() {
    isNsfwScanning = false
    nsfwScanJob?.cancel()
  }

  private fun analyzeNsfwHeuristics(path: String): Pair<Boolean, Double> {
    return try {
      val lower = path.lowercase()
      if (lower.contains("secret") || lower.contains("private") || lower.contains("vault") || lower.contains("nsfw")) {
        return Pair(true, 0.90)
      }

      val options = BitmapFactory.Options().apply {
        inSampleSize = 8
      }
      val bmp = BitmapFactory.decodeFile(path, options) ?: return Pair(false, 0.0)

      var skinPixels = 0
      var totalPixels = 0
      val step = 4

      for (x in 0 until bmp.width step step) {
        for (y in 0 until bmp.height step step) {
          val pixel = bmp.getPixel(x, y)
          val r = Color.red(pixel)
          val g = Color.green(pixel)
          val b = Color.blue(pixel)

          if (r > 95 && g > 40 && b > 20 &&
            (maxOf(r, maxOf(g, b)) - minOf(r, minOf(g, b))) > 15 &&
            abs(r - g) > 15 && r > g && r > b
          ) {
            skinPixels++
          }
          totalPixels++
        }
      }
      bmp.recycle()

      val skinRatio = if (totalPixels > 0) skinPixels.toDouble() / totalPixels else 0.0
      if (skinRatio > 0.45) {
        Pair(true, skinRatio)
      } else {
        Pair(false, skinRatio)
      }
    } catch (e: Exception) {
      Pair(false, 0.0)
    }
  }
}
