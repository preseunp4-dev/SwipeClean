package com.swipeclean.photoquality

import android.content.ContentUris
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceLandmark
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.max
import java.util.concurrent.CountDownLatch

class PhotoQualityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PhotoQualityModule")

    AsyncFunction("analyzePhotos") { localIdentifiers: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()

      val faceOptions = FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
        .build()
      val faceDetector = FaceDetection.getClient(faceOptions)

      for (id in localIdentifiers) {
        val result = mutableMapOf<String, Any>(
          "id" to id,
          "sharpness" to 0.5,
          "exposure" to 0.5,
          "facesDetected" to 0,
          "eyesOpen" to false,
          "smiling" to false,
          "faceQuality" to 0.0,
          "compositeScore" to 50.0
        )

        try {
          // Parse numeric ID from the identifier
          val numericId = id.toLongOrNull() ?: continue
          val uri = ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), numericId)

          // Load bitmap at reduced size for speed
          val bitmap = loadScaledBitmap(context, uri, 800) ?: continue

          // 1. Sharpness (Laplacian variance)
          val sharpness = calculateSharpness(bitmap)
          result["sharpness"] = sharpness

          // 2. Exposure (average brightness)
          val exposure = calculateExposure(bitmap)
          result["exposure"] = exposure

          // 3. Face detection with ML Kit
          val faceResult = analyzeFaces(faceDetector, bitmap)
          result["facesDetected"] = faceResult.faceCount
          result["eyesOpen"] = faceResult.eyesOpen
          result["smiling"] = faceResult.smiling
          result["faceQuality"] = faceResult.quality

          // 4. Get resolution and file size
          val resolution = getResolution(context, numericId)
          val fileSize = getFileSize(context, numericId)
          val resolutionScore = min(resolution / 12_000_000.0, 1.0)
          val fileSizeScore = min(fileSize / 10_000_000.0, 1.0)

          // Exposure score
          val exposureScore = 1.0 - abs(exposure - 0.5) * 2.0

          // Composite score
          var composite = 0.0
          composite += sharpness * 30
          composite += exposureScore * 15
          composite += resolutionScore * 10
          composite += fileSizeScore * 10

          if (faceResult.faceCount > 0) {
            composite += faceResult.quality * 15
            if (faceResult.eyesOpen) composite += 10
            if (faceResult.smiling) composite += 10
          } else {
            composite += sharpness * 20
            composite += exposureScore * 15
          }

          result["compositeScore"] = min(composite, 100.0)

          bitmap.recycle()
        } catch (e: Exception) {
          // Skip failed photos
        }

        results.add(result)
      }

      faceDetector.close()
      results
    }
  }

  private fun loadScaledBitmap(context: android.content.Context, uri: Uri, maxSize: Int): Bitmap? {
    return try {
      val input = context.contentResolver.openInputStream(uri) ?: return null
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeStream(input, null, options)
      input.close()

      val scale = max(1, max(options.outWidth, options.outHeight) / maxSize)
      val decodeOptions = BitmapFactory.Options().apply { inSampleSize = scale }
      val input2 = context.contentResolver.openInputStream(uri) ?: return null
      val bitmap = BitmapFactory.decodeStream(input2, null, decodeOptions)
      input2.close()
      bitmap
    } catch (e: Exception) { null }
  }

  private fun calculateSharpness(bitmap: Bitmap): Double {
    // Laplacian variance on grayscale center crop
    val w = bitmap.width
    val h = bitmap.height
    val cx = w / 2
    val cy = h / 2
    val size = min(min(w, h), 200)
    val startX = max(0, cx - size / 2)
    val startY = max(0, cy - size / 2)
    val endX = min(w - 1, startX + size - 1)
    val endY = min(h - 1, startY + size - 1)

    var variance = 0.0
    var count = 0

    for (y in (startY + 1) until endY) {
      for (x in (startX + 1) until endX) {
        val center = grayAt(bitmap, x, y)
        val laplacian = -4 * center +
          grayAt(bitmap, x - 1, y) + grayAt(bitmap, x + 1, y) +
          grayAt(bitmap, x, y - 1) + grayAt(bitmap, x, y + 1)
        variance += laplacian * laplacian
        count++
      }
    }

    if (count == 0) return 0.5
    val avg = variance / count
    return min(avg / 2000.0, 1.0) // Normalize
  }

  private fun grayAt(bitmap: Bitmap, x: Int, y: Int): Double {
    val pixel = bitmap.getPixel(x, y)
    return Color.red(pixel) * 0.299 + Color.green(pixel) * 0.587 + Color.blue(pixel) * 0.114
  }

  private fun calculateExposure(bitmap: Bitmap): Double {
    var totalBrightness = 0.0
    val step = max(1, (bitmap.width * bitmap.height) / 10000) // Sample ~10000 pixels
    var count = 0
    for (i in 0 until bitmap.width * bitmap.height step step) {
      val x = i % bitmap.width
      val y = i / bitmap.width
      if (y >= bitmap.height) break
      val pixel = bitmap.getPixel(x, y)
      totalBrightness += (Color.red(pixel) * 0.299 + Color.green(pixel) * 0.587 + Color.blue(pixel) * 0.114) / 255.0
      count++
    }
    return if (count > 0) totalBrightness / count else 0.5
  }

  data class FaceResult(
    val faceCount: Int = 0,
    val eyesOpen: Boolean = false,
    val smiling: Boolean = false,
    val quality: Double = 0.0
  )

  private fun analyzeFaces(detector: com.google.mlkit.vision.face.FaceDetector, bitmap: Bitmap): FaceResult {
    val latch = CountDownLatch(1)
    var result = FaceResult()

    val image = InputImage.fromBitmap(bitmap, 0)
    detector.process(image)
      .addOnSuccessListener { faces ->
        if (faces.isNotEmpty()) {
          val primaryFace = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]

          val eyesOpen = (primaryFace.leftEyeOpenProbability ?: 0f) > 0.5f &&
            (primaryFace.rightEyeOpenProbability ?: 0f) > 0.5f

          val smiling = (primaryFace.smilingProbability ?: 0f) > 0.3f

          // Quality based on face size relative to image + classification confidences
          val faceArea = primaryFace.boundingBox.width().toDouble() * primaryFace.boundingBox.height() / (bitmap.width * bitmap.height)
          val quality = min(faceArea * 4.0 + (primaryFace.smilingProbability?.toDouble() ?: 0.0) * 0.3 + ((primaryFace.leftEyeOpenProbability?.toDouble() ?: 0.0) + (primaryFace.rightEyeOpenProbability?.toDouble() ?: 0.0)) * 0.15, 1.0)

          result = FaceResult(
            faceCount = faces.size,
            eyesOpen = eyesOpen,
            smiling = smiling,
            quality = quality
          )
        }
        latch.countDown()
      }
      .addOnFailureListener { latch.countDown() }

    latch.await()
    return result
  }

  private fun getResolution(context: android.content.Context, id: Long): Double {
    val cursor = context.contentResolver.query(
      MediaStore.Files.getContentUri("external"),
      arrayOf(MediaStore.MediaColumns.WIDTH, MediaStore.MediaColumns.HEIGHT),
      "${MediaStore.MediaColumns._ID} = ?",
      arrayOf(id.toString()),
      null
    )
    cursor?.use {
      if (it.moveToFirst()) {
        val w = it.getInt(0).toDouble()
        val h = it.getInt(1).toDouble()
        return w * h
      }
    }
    return 0.0
  }

  private fun getFileSize(context: android.content.Context, id: Long): Double {
    val cursor = context.contentResolver.query(
      MediaStore.Files.getContentUri("external"),
      arrayOf(MediaStore.MediaColumns.SIZE),
      "${MediaStore.MediaColumns._ID} = ?",
      arrayOf(id.toString()),
      null
    )
    cursor?.use {
      if (it.moveToFirst()) return it.getLong(0).toDouble()
    }
    return 0.0
  }
}
