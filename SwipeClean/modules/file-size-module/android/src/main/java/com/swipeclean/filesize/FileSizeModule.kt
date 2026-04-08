package com.swipeclean.filesize

import android.content.ContentUris
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.max

class FileSizeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FileSizeModule")

    // --- Existing ---
    AsyncFunction("getFileSizes") { localIdentifiers: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()
      val ids = localIdentifiers.mapNotNull { it.toLongOrNull() }
      if (ids.isEmpty()) return@AsyncFunction results
      val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.SIZE)
      ids.chunked(500).forEach { chunk ->
        val selection = "${MediaStore.Files.FileColumns._ID} IN (${chunk.joinToString(",")})"
        context.contentResolver.query(MediaStore.Files.getContentUri("external"), projection, selection, null, null)?.use {
          val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
          val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
          while (it.moveToNext()) { results.add(mapOf("id" to it.getLong(idCol).toString(), "fileSize" to it.getLong(sizeCol))) }
        }
      }
      results
    }

    // --- Existing ---
    AsyncFunction("getAllFileSizesSorted") { mediaTypes: List<Int> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()
      val typeFilters = mediaTypes.mapNotNull { type ->
        when (type) { 1 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
          2 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"; else -> null }
      }
      if (typeFilters.isEmpty()) return@AsyncFunction results
      val selection = "(${typeFilters.joinToString(" OR ")}) AND ${MediaStore.Files.FileColumns.SIZE} > 0"
      context.contentResolver.query(MediaStore.Files.getContentUri("external"), arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.SIZE), selection, null, "${MediaStore.Files.FileColumns.SIZE} DESC")?.use {
        val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
        var count = 0
        while (it.moveToNext() && count < 500) { results.add(mapOf("id" to it.getLong(idCol).toString(), "fileSize" to it.getLong(sizeCol))); count++ }
      }
      results
    }

    // --- NEW: Get largest unseen ---
    AsyncFunction("getLargestUnseen") { seenIds: List<String>, mediaTypes: List<Int>, limit: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val seenSet = seenIds.mapNotNull { it.toLongOrNull() }.toSet()
      val results = mutableListOf<Map<String, Any>>()
      val typeFilters = mediaTypes.mapNotNull { type ->
        when (type) { 1 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
          2 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"; else -> null }
      }
      if (typeFilters.isEmpty()) return@AsyncFunction results
      val selection = "(${typeFilters.joinToString(" OR ")}) AND ${MediaStore.Files.FileColumns.SIZE} > 0"
      context.contentResolver.query(MediaStore.Files.getContentUri("external"), arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.SIZE), selection, null, "${MediaStore.Files.FileColumns.SIZE} DESC")?.use {
        val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
        var count = 0
        while (it.moveToNext() && count < limit) {
          val id = it.getLong(idCol)
          if (!seenSet.contains(id)) { results.add(mapOf("id" to id.toString(), "fileSize" to it.getLong(sizeCol))); count++ }
        }
      }
      results
    }

    // --- NEW: Get all assets natively ---
    AsyncFunction("getAllAssetsNative") { mediaTypes: List<Int> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val results = mutableListOf<Map<String, Any>>()
      val typeFilters = mediaTypes.mapNotNull { type ->
        when (type) { 1 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
          2 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"; else -> null }
      }
      if (typeFilters.isEmpty()) return@AsyncFunction results
      val selection = "(${typeFilters.joinToString(" OR ")})"
      val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Files.FileColumns.SIZE,
        MediaStore.Files.FileColumns.WIDTH, MediaStore.Files.FileColumns.HEIGHT, MediaStore.Files.FileColumns.DATE_ADDED, MediaStore.Files.FileColumns.DURATION)
      context.contentResolver.query(MediaStore.Files.getContentUri("external"), projection, selection, null, "${MediaStore.Files.FileColumns.DATE_ADDED} ASC")?.use {
        val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val typeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
        val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
        val widthCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.WIDTH)
        val heightCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.HEIGHT)
        val dateCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED)
        val durCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DURATION)
        while (it.moveToNext()) {
          val id = it.getLong(idCol)
          val mType = if (it.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE) "photo" else "video"
          val dur = (it.getLong(durCol) / 1000.0) // ms to seconds
          results.add(mapOf("id" to id.toString(), "mediaType" to mType, "width" to it.getInt(widthCol), "height" to it.getInt(heightCol),
            "creationTime" to it.getLong(dateCol).toDouble(), "duration" to dur, "fileSize" to it.getLong(sizeCol), "uri" to id.toString()))
        }
      }
      results
    }

    // --- NEW: Find duplicate groups natively ---
    AsyncFunction("findDuplicateGroups") { mediaTypes: List<Int>, timeWindowMs: Int, minSizeRatio: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      data class Asset(val id: String, val time: Double, val width: Int, val height: Int, val size: Long, val mediaType: String, val duration: Double, val uri: String)
      val allAssets = mutableListOf<Asset>()
      val typeFilters = mediaTypes.mapNotNull { type ->
        when (type) { 1 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
          2 -> "${MediaStore.Files.FileColumns.MEDIA_TYPE} = ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"; else -> null }
      }
      if (typeFilters.isEmpty()) return@AsyncFunction emptyList<Map<String, Any>>()
      val selection = "(${typeFilters.joinToString(" OR ")})"
      val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Files.FileColumns.SIZE,
        MediaStore.Files.FileColumns.WIDTH, MediaStore.Files.FileColumns.HEIGHT, MediaStore.Files.FileColumns.DATE_ADDED, MediaStore.Files.FileColumns.DURATION)
      context.contentResolver.query(MediaStore.Files.getContentUri("external"), projection, selection, null, "${MediaStore.Files.FileColumns.DATE_ADDED} ASC")?.use {
        val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
        val typeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
        val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
        val widthCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.WIDTH)
        val heightCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.HEIGHT)
        val dateCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED)
        val durCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DURATION)
        while (it.moveToNext()) {
          val id = it.getLong(idCol)
          val mType = if (it.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE) "photo" else "video"
          allAssets.add(Asset(id.toString(), it.getLong(dateCol).toDouble() * 1000, it.getInt(widthCol), it.getInt(heightCol), it.getLong(sizeCol), mType, it.getLong(durCol) / 1000.0, id.toString()))
        }
      }

      val timeWindow = timeWindowMs.toDouble()
      val used = mutableSetOf<String>()
      val groups = mutableListOf<Map<String, Any>>()
      var groupId = 0

      var windowStart = 0
      for (i in allAssets.indices) {
        while (windowStart < i && allAssets[i].time - allAssets[windowStart].time > timeWindow) windowStart++
        if (used.contains(allAssets[i].id)) continue
        val cluster = mutableListOf(i)
        used.add(allAssets[i].id)
        for (j in windowStart until allAssets.size) {
          if (j == i) continue
          if (allAssets[j].time - allAssets[i].time > timeWindow) break
          if (used.contains(allAssets[j].id)) continue
          if (allAssets[j].width == allAssets[i].width && allAssets[j].height == allAssets[i].height) {
            val sA = allAssets[i].size; val sB = allAssets[j].size
            if (sA > 0 && sB > 0) { val ratio = min(sA, sB).toDouble() / max(sA, sB).toDouble(); if (ratio < minSizeRatio) continue }
            cluster.add(j); used.add(allAssets[j].id)
          }
        }
        if (cluster.size >= 2) {
          val assets = cluster.map { idx -> val a = allAssets[idx]
            mapOf("id" to a.id, "mediaType" to a.mediaType, "width" to a.width, "height" to a.height, "creationTime" to a.time / 1000, "duration" to a.duration, "fileSize" to a.size, "uri" to a.uri) }
          groups.add(mapOf("id" to "group-$groupId", "type" to "burst", "assets" to assets)); groupId++
        }
      }

      // Exact duplicates
      val remaining = allAssets.filter { !used.contains(it.id) }
      val sizeMap = mutableMapOf<String, MutableList<Int>>()
      remaining.forEachIndexed { idx, a -> if (a.size > 0) sizeMap.getOrPut("${a.size}_${a.width}x${a.height}") { mutableListOf() }.add(idx) }
      sizeMap.values.filter { it.size >= 2 }.forEach { indices ->
        val assets = indices.map { idx -> val a = remaining[idx]
          mapOf("id" to a.id, "mediaType" to a.mediaType, "width" to a.width, "height" to a.height, "creationTime" to a.time / 1000, "duration" to a.duration, "fileSize" to a.size, "uri" to a.uri) }
        groups.add(mapOf("id" to "group-$groupId", "type" to "exact", "assets" to assets)); groupId++
      }

      groups
    }
  }
}
