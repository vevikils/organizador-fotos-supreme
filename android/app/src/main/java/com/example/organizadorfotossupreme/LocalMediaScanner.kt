package com.example.organizadorfotossupreme

import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class LocalMediaScanner(private val context: Context, private val db: LocalDatabase) {
  var isScanning = false
    private set

  var totalFound = 0
    private set
  var processed = 0
    private set
  var currentFile = ""
    private set

  suspend fun scanDevicePhotos(onProgress: ((processed: Int, total: Int, fileName: String) -> Unit)? = null): Int = withContext(Dispatchers.IO) {
    if (isScanning) return@withContext processed
    isScanning = true
    processed = 0
    totalFound = 0

    val projection = arrayOf(
      MediaStore.Images.Media._ID,
      MediaStore.Images.Media.DISPLAY_NAME,
      MediaStore.Images.Media.DATA,
      MediaStore.Images.Media.SIZE,
      MediaStore.Images.Media.DATE_TAKEN,
      MediaStore.Images.Media.DATE_ADDED,
      MediaStore.Images.Media.WIDTH,
      MediaStore.Images.Media.HEIGHT,
      MediaStore.Images.Media.BUCKET_DISPLAY_NAME
    )

    val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
    val cursor = context.contentResolver.query(
      MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
      projection,
      null,
      null,
      sortOrder
    )

    val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    cursor?.use {
      totalFound = it.count
      val idCol = it.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
      val nameCol = it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
      val dataCol = it.getColumnIndex(MediaStore.Images.Media.DATA)
      val sizeCol = it.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
      val dateTakenCol = it.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN)
      val dateAddedCol = it.getColumnIndex(MediaStore.Images.Media.DATE_ADDED)
      val widthCol = it.getColumnIndex(MediaStore.Images.Media.WIDTH)
      val heightCol = it.getColumnIndex(MediaStore.Images.Media.HEIGHT)
      val bucketCol = it.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)

      while (it.moveToNext()) {
        val id = it.getLong(idCol)
        val name = it.getString(nameCol) ?: "IMG_$id.jpg"
        val path = if (dataCol != -1) it.getString(dataCol) ?: "" else ""
        val size = it.getLong(sizeCol)
        val dateTakenMs = if (dateTakenCol != -1) it.getLong(dateTakenCol) else 0L
        val dateAddedSec = if (dateAddedCol != -1) it.getLong(dateAddedCol) else 0L

        val dateTakenStr = if (dateTakenMs > 0) {
          dateFormat.format(Date(dateTakenMs))
        } else if (dateAddedSec > 0) {
          dateFormat.format(Date(dateAddedSec * 1000L))
        } else {
          dateFormat.format(Date())
        }

        val width = if (widthCol != -1) it.getInt(widthCol) else 0
        val height = if (heightCol != -1) it.getInt(heightCol) else 0
        val bucket = if (bucketCol != -1) it.getString(bucketCol) ?: "Fotos" else "Fotos"

        val effectivePath = if (path.isNotEmpty()) path else ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString()

        db.insertOrUpdatePhoto(
          fileName = name,
          filePath = effectivePath,
          fileSize = size,
          dateTaken = dateTakenStr,
          width = width,
          height = height,
          category = bucket
        )

        processed++
        currentFile = name

        if (processed % 10 == 0 || processed == totalFound) {
          onProgress?.invoke(processed, totalFound, name)
        }
      }
    }

    isScanning = false
    return@withContext processed
  }
}
