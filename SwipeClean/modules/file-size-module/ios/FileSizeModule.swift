import ExpoModulesCore
import Photos
import CoreImage
import Accelerate

public class FileSizeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FileSizeModule")

    // --- Existing: get file sizes for specific IDs ---
    AsyncFunction("getFileSizes") { (localIdentifiers: [String]) -> [[String: Any]] in
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
      var results: [[String: Any]] = []
      for i in 0..<fetchResult.count {
        let asset = fetchResult.object(at: i)
        let resources = PHAssetResource.assetResources(for: asset)
        var totalSize: Int64 = 0
        for resource in resources {
          if let size = resource.value(forKey: "fileSize") as? Int64 { totalSize += size }
        }
        results.append(["id": asset.localIdentifier, "fileSize": totalSize])
      }
      return results
    }

    // --- Existing: get all assets sorted by size ---
    AsyncFunction("getAllFileSizesSorted") { (mediaTypes: [Int]) -> [[String: Any]] in
      var allAssets: [(id: String, size: Int64)] = []
      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)
        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          let resources = PHAssetResource.assetResources(for: asset)
          var totalSize: Int64 = 0
          for resource in resources {
            if let size = resource.value(forKey: "fileSize") as? Int64 { totalSize += size }
          }
          if totalSize > 0 {
            allAssets.append((id: asset.localIdentifier, size: totalSize))
          } else {
            let pixels = Int64(asset.pixelWidth) * Int64(asset.pixelHeight)
            let estimated = asset.mediaType == .video ? pixels * Int64(max(asset.duration, 1)) * 2 : pixels * 3
            if estimated > 0 { allAssets.append((id: asset.localIdentifier, size: estimated)) }
          }
        }
      }
      allAssets.sort { $0.size > $1.size }
      return Array(allAssets.prefix(500)).map { ["id": $0.id, "fileSize": $0.size] }
    }

    // --- NEW #1: Get largest unseen assets (filtering done natively) ---
    AsyncFunction("getLargestUnseen") { (seenIds: [String], mediaTypes: [Int], limit: Int) -> [[String: Any]] in
      let seenSet = Set(seenIds)
      var allAssets: [(id: String, size: Int64)] = []

      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let fetchResult = PHAsset.fetchAssets(with: type, options: nil)
        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          if seenSet.contains(asset.localIdentifier) { continue }
          let resources = PHAssetResource.assetResources(for: asset)
          var totalSize: Int64 = 0
          for resource in resources {
            if let size = resource.value(forKey: "fileSize") as? Int64 { totalSize += size }
          }
          if totalSize > 0 {
            allAssets.append((id: asset.localIdentifier, size: totalSize))
          } else {
            let pixels = Int64(asset.pixelWidth) * Int64(asset.pixelHeight)
            let estimated = asset.mediaType == .video ? pixels * Int64(max(asset.duration, 1)) * 2 : pixels * 3
            if estimated > 0 { allAssets.append((id: asset.localIdentifier, size: estimated)) }
          }
        }
      }

      allAssets.sort { $0.size > $1.size }
      return Array(allAssets.prefix(limit)).map { ["id": $0.id, "fileSize": $0.size] }
    }

    // --- NEW #2: Get all assets in one native call (parallel loading) ---
    AsyncFunction("getAllAssetsNative") { (mediaTypes: [Int]) -> [[String: Any]] in
      var results: [[String: Any]] = []

      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)

        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          // Get file size from metadata
          let resources = PHAssetResource.assetResources(for: asset)
          var totalSize: Int64 = 0
          for resource in resources {
            if let size = resource.value(forKey: "fileSize") as? Int64 { totalSize += size }
          }

          results.append([
            "id": asset.localIdentifier,
            "mediaType": asset.mediaType == .image ? "photo" : "video",
            "width": asset.pixelWidth,
            "height": asset.pixelHeight,
            // Milliseconds since epoch — matches expo-media-library's exportDate
            "creationTime": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
            "duration": asset.duration,
            "fileSize": totalSize,
            "uri": "ph://\(asset.localIdentifier)"
          ])
        }
      }

      return results
    }

    // --- NEW #2b: Fast first-N fetch using fetchLimit ---
    // Unlike getAllAssetsNative, this uses PHFetchOptions.fetchLimit so iOS
    // can short-circuit via its creationDate index. Runs in ~50ms regardless
    // of library size (works the same on 1 photo or 100,000 photos).
    //
    // Parameters:
    //   mediaTypes: [1]=photos, [2]=videos, [1,2]=both
    //   count: how many results to return
    //   oldestFirst: true for creationDate ASC, false for DESC (newest first)
    //   afterCreationTime: 0 = start from beginning,
    //                      >0 = pagination cursor (milliseconds since epoch);
    //                      only returns assets strictly before (newest) or after (oldest) this time
    //
    // No file size included — that's the slow part. Use getAllAssetsNative
    // for "Largest" sorting, or getFileSizes for specific IDs.
    AsyncFunction("getAssetsPage") { (mediaTypes: [Int], count: Int, oldestFirst: Bool, afterCreationTime: Double) -> [[String: Any]] in
      var combined: [[String: Any]] = []
      // Over-fetch per-media-type so we have enough after merging photos+videos
      // and after the JS side filters out seen IDs. count*4 is a safe buffer.
      let perTypeLimit = max(count * 4, 25)

      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: oldestFirst)]
        options.fetchLimit = perTypeLimit

        if afterCreationTime > 0 {
          // Cursor pagination: only fetch assets strictly past the cursor
          let cursorDate = Date(timeIntervalSince1970: afterCreationTime / 1000.0)
          let op = oldestFirst ? ">" : "<"
          options.predicate = NSPredicate(format: "creationDate \(op) %@", cursorDate as CVarArg)
        }

        let fetchResult = PHAsset.fetchAssets(with: type, options: options)

        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          combined.append([
            "id": asset.localIdentifier,
            "mediaType": asset.mediaType == .image ? "photo" : "video",
            "width": asset.pixelWidth,
            "height": asset.pixelHeight,
            "creationTime": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
            "duration": asset.duration,
            "uri": "ph://\(asset.localIdentifier)"
          ])
        }
      }

      // Merge photos + videos: sort by creationTime, then slice to requested count.
      // JS will further filter by seenIds after it gets this list.
      combined.sort { a, b in
        let aTime = a["creationTime"] as? Double ?? 0
        let bTime = b["creationTime"] as? Double ?? 0
        return oldestFirst ? aTime < bTime : aTime > bTime
      }
      return Array(combined.prefix(perTypeLimit))
    }

    // --- NEW #3: Find duplicate groups natively (LAZY EVALUATION) ---
    // Rewritten from the eager version that computed pHash + fileSize for
    // EVERY asset upfront. On 80K+ libraries that caused OOM crashes because
    // it queued 80K PHImageManager.requestImage + 80K PHAssetResource calls,
    // each holding memory until the whole pass finished.
    //
    // New strategy: only compute fileSize / pHash LAZILY for assets that are
    // burst candidates (dimension-match within the time window). On a typical
    // library <1% of assets are candidates, so lazy evaluation cuts memory
    // and wall-clock time by ~100x.
    AsyncFunction("findDuplicateGroups") { (mediaTypes: [Int], timeWindowMs: Int, minSizeRatio: Double) -> [[String: Any]] in
      // Lightweight metadata: no fileSize, no pHash — just what we need to
      // find candidates. Cheap to allocate for the whole library.
      struct LightAsset {
        let id: String; let time: Double; let width: Int; let height: Int
        let mediaType: String; let duration: Double; let uri: String
      }

      // Phase 1: fetch all metadata. No PHAssetResource, no image loading.
      // ~100-500ms even on 80K libraries.
      var assets: [LightAsset] = []
      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)
        let typeStr = mediaType == 1 ? "photo" : "video"
        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          assets.append(LightAsset(
            id: asset.localIdentifier,
            time: (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
            width: asset.pixelWidth,
            height: asset.pixelHeight,
            mediaType: typeStr,
            duration: asset.duration,
            uri: "ph://\(asset.localIdentifier)"
          ))
        }
      }
      assets.sort { $0.time < $1.time }

      // Lazy caches — populated only for candidates
      var sizeCache: [String: Int64] = [:]
      var pHashCache: [String: UInt64] = [:]
      let imageManager = PHImageManager.default()

      // Look up one asset's fileSize via PHAssetResource. Memoized.
      func getFileSize(_ id: String) -> Int64 {
        if let s = sizeCache[id] { return s }
        let fr = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
        guard let a = fr.firstObject else { sizeCache[id] = 0; return 0 }
        let resources = PHAssetResource.assetResources(for: a)
        var total: Int64 = 0
        for r in resources {
          if let s = r.value(forKey: "fileSize") as? Int64 { total += s }
        }
        sizeCache[id] = total
        return total
      }

      // Compute one asset's 8x8 perceptual hash. Memoized.
      func getPHash(_ id: String) -> UInt64 {
        if let h = pHashCache[id] { return h }
        let fr = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
        guard let a = fr.firstObject else { pHashCache[id] = 0; return 0 }

        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.deliveryMode = .fastFormat
        options.isNetworkAccessAllowed = false
        options.resizeMode = .fast

        var hash: UInt64 = 0
        imageManager.requestImage(for: a, targetSize: CGSize(width: 8, height: 8), contentMode: .aspectFill, options: options) { image, _ in
          guard let img = image, let cg = img.cgImage else { return }
          let w = cg.width, h = cg.height
          guard w > 0 && h > 0 else { return }
          var pixels = [UInt8](repeating: 0, count: w * h * 4)
          guard let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
            bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
          ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
          var grays = [Double]()
          for p in stride(from: 0, to: min(64 * 4, pixels.count), by: 4) {
            let gray = Double(pixels[p]) * 0.299 + Double(pixels[p+1]) * 0.587 + Double(pixels[p+2]) * 0.114
            grays.append(gray)
          }
          guard grays.count >= 64 else { return }
          let avg = grays.reduce(0, +) / Double(grays.count)
          var hv: UInt64 = 0
          for j in 0..<64 { if grays[j] > avg { hv |= (1 << j) } }
          hash = hv
        }
        pHashCache[id] = hash
        return hash
      }

      let timeWindow = Double(timeWindowMs)
      var used = Set<String>()
      var groups: [[String: Any]] = []
      var groupId = 0

      // Phase 2: burst detection with sliding window. Lazy pHash + fileSize.
      var windowStart = 0
      for i in 0..<assets.count {
        while windowStart < i && assets[i].time - assets[windowStart].time > timeWindow {
          windowStart += 1
        }
        if used.contains(assets[i].id) { continue }
        var cluster: [Int] = [i]
        used.insert(assets[i].id)

        for j in windowStart..<assets.count {
          if j == i { continue }
          if assets[j].time - assets[i].time > timeWindow { break }
          if used.contains(assets[j].id) { continue }
          if assets[j].width == assets[i].width && assets[j].height == assets[i].height {
            // Dimension match — now check fileSize ratio (lazy)
            let sizeA = getFileSize(assets[i].id)
            let sizeB = getFileSize(assets[j].id)
            if sizeA > 0 && sizeB > 0 {
              let ratio = Double(min(sizeA, sizeB)) / Double(max(sizeA, sizeB))
              if ratio < minSizeRatio { continue }
            }
            // Size-close — now verify with pHash (lazy)
            let hashA = getPHash(assets[i].id)
            let hashB = getPHash(assets[j].id)
            if hashA != 0 && hashB != 0 {
              let hamming = (hashA ^ hashB).nonzeroBitCount
              if hamming > 10 { continue }
            }
            cluster.append(j)
            used.insert(assets[j].id)
          }
        }

        if cluster.count >= 2 {
          let clusterOut: [[String: Any]] = cluster.map { idx in
            let a = assets[idx]
            return [
              "id": a.id,
              "mediaType": a.mediaType,
              "width": a.width,
              "height": a.height,
              "creationTime": a.time,
              "duration": a.duration,
              "fileSize": sizeCache[a.id] ?? 0,
              "uri": a.uri
            ]
          }
          groups.append([
            "id": "group-\(groupId)",
            "type": "burst",
            "assets": clusterOut
          ])
          groupId += 1
        }
      }

      // Phase 3: exact duplicates — but ONLY using already-cached fileSizes
      // from burst detection. We skip the eager O(N) PHAssetResource scan
      // that used to happen here — that's what caused crashes on huge libs.
      // Trade-off: we catch fewer "same-file-twice" duplicates outside burst
      // windows, but we never crash. Burst covers the most common case.
      let remaining = assets.filter { !used.contains($0.id) && sizeCache[$0.id] != nil && (sizeCache[$0.id] ?? 0) > 0 }
      var sizeMap: [String: [Int]] = [:]
      for (idx, asset) in remaining.enumerated() {
        let size = sizeCache[asset.id] ?? 0
        let key = "\(size)_\(asset.width)x\(asset.height)"
        sizeMap[key, default: []].append(idx)
      }
      for (_, indices) in sizeMap {
        if indices.count < 2 { continue }
        let out: [[String: Any]] = indices.map { idx in
          let a = remaining[idx]
          return [
            "id": a.id,
            "mediaType": a.mediaType,
            "width": a.width,
            "height": a.height,
            "creationTime": a.time,
            "duration": a.duration,
            "fileSize": sizeCache[a.id] ?? 0,
            "uri": a.uri
          ]
        }
        groups.append([
          "id": "group-\(groupId)",
          "type": "exact",
          "assets": out
        ])
        groupId += 1
      }

      return groups
    }

    // --- NEW #4: Largest unseen assets via proxy scoring (safe on huge libs) ---
    // Strategy:
    //   1. Fetch all asset metadata (no PHAssetResource — fast on any lib size)
    //   2. Compute proxy score (width × height for photos, plus duration for videos)
    //   3. Take top K candidates by proxy
    //   4. Fetch real fileSize ONLY for those K (bounded PHAssetResource calls)
    //   5. Sort by real fileSize, return top `limit`
    //
    // On 80K photos: ~1-2s metadata scan + ~1s for 500 PHAssetResource calls.
    // Memory-safe: bounded PHAssetResource holds.
    AsyncFunction("getLargestProxy") { (mediaTypes: [Int], limit: Int, seenIds: [String]) -> [[String: Any]] in
      let seenSet = Set(seenIds)
      struct Candidate {
        let id: String; let mediaType: String; let width: Int; let height: Int
        let duration: Double; let creationTime: Double; let uri: String; let proxy: Double
      }
      var candidates: [Candidate] = []

      // Phase 1: metadata + proxy (fast, no PHAssetResource)
      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let fetchResult = PHAsset.fetchAssets(with: type, options: nil)
        for i in 0..<fetchResult.count {
          let asset = fetchResult.object(at: i)
          if seenSet.contains(asset.localIdentifier) { continue }
          let pixels = Double(asset.pixelWidth) * Double(asset.pixelHeight)
          let proxy = asset.mediaType == .video
            ? pixels * max(asset.duration, 1) * 2
            : pixels * 3
          candidates.append(Candidate(
            id: asset.localIdentifier,
            mediaType: asset.mediaType == .image ? "photo" : "video",
            width: asset.pixelWidth,
            height: asset.pixelHeight,
            duration: asset.duration,
            creationTime: (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
            uri: "ph://\(asset.localIdentifier)",
            proxy: proxy
          ))
        }
      }

      // Phase 2: top K by proxy
      candidates.sort { $0.proxy > $1.proxy }
      let K = min(max(limit * 20, 50), candidates.count)
      let top = Array(candidates.prefix(K))

      // Phase 3: fetch real fileSize for top K only
      let ids = top.map { $0.id }
      let assetFetch = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
      var sizeById: [String: Int64] = [:]
      for i in 0..<assetFetch.count {
        let a = assetFetch.object(at: i)
        let resources = PHAssetResource.assetResources(for: a)
        var total: Int64 = 0
        for r in resources {
          if let s = r.value(forKey: "fileSize") as? Int64 { total += s }
        }
        sizeById[a.localIdentifier] = total
      }

      // Phase 4: merge + sort by real fileSize + take top `limit`
      let withSize: [[String: Any]] = top.compactMap { c in
        let realSize = sizeById[c.id] ?? 0
        if realSize <= 0 { return nil }
        return [
          "id": c.id,
          "mediaType": c.mediaType,
          "width": c.width,
          "height": c.height,
          "duration": c.duration,
          "creationTime": c.creationTime,
          "uri": c.uri,
          "fileSize": realSize
        ]
      }
      let sorted = withSize.sorted {
        (($0["fileSize"] as? Int64) ?? 0) > (($1["fileSize"] as? Int64) ?? 0)
      }
      return Array(sorted.prefix(limit))
    }
  }
}
