package com.swipeclean.filesize

import android.content.ContentUris
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FileSizeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FileSizeModule")

    AsyncFunction("getFileSizes") { localIdentifiers: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()

      // On Android, expo-media-library asset IDs are MediaStore numeric IDs
      val ids = localIdentifiers.mapNotNull { it.toLongOrNull() }
      if (ids.isEmpty()) return@AsyncFunction results

      val projection = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.SIZE
      )

      // Query in batches of 500 (SQL IN clause limit)
      ids.chunked(500).forEach { chunk ->
        val selection = "${MediaStore.Files.FileColumns._ID} IN (${chunk.joinToString(",")})"
        val cursor = context.contentResolver.query(
          MediaStore.Files.getContentUri("external"),
          projection,
          selection,
          null,
          null
        )
        cursor?.use {
          val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
          val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
          while (it.moveToNext()) {
            val id = it.getLong(idCol)
            val size = it.getLong(sizeCol)
            results.add(mapOf("id" to id.toString(), "fileSize" to size))
          }
        }
      }

      results
    }

    AsyncFunction("getAllFileSizesSorted") { mediaTypes: List<Int> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()

      val projection = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.SIZE,
        MediaStore.Files.FileColumns.MEDIA_TYPE
      )

      // Build media type filter: 1 = image, 2 = video
      val typeFilters = mediaTypes.map { type ->
        when (type) {
          1 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
          2 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"
          else -> null
        }
      }.filterNotNull()

      if (typeFilters.isEmpty()) return@AsyncFunction results

      val selection = "(${typeFilters.joinToString(" OR ")}) AND ${MediaStore.Files.FileColumns.SIZE} > 0"

      val cursor = context.contentResolver.query(
        MediaStore.Files.getContentUri("external"),
        projection,
        selection,
        null,
        "${MediaStore.Files.FileColumns.SIZE} DESC"
      )

      cursor?.use {
        val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
        var count = 0
        while (it.moveToNext() && count < 500) {
          val id = it.getLong(idCol)
          val size = it.getLong(sizeCol)
          results.add(mapOf("id" to id.toString(), "fileSize" to size))
          count++
        }
      }

      results
    }
  }
}
