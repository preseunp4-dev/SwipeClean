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
            "creationTime": asset.creationDate?.timeIntervalSince1970 ?? 0,
            "duration": asset.duration,
            "fileSize": totalSize,
            "uri": "ph://\(asset.localIdentifier)"
          ])
        }
      }

      return results
    }

    // --- NEW #3: Find duplicate groups natively ---
    AsyncFunction("findDuplicateGroups") { (mediaTypes: [Int], timeWindowMs: Int, minSizeRatio: Double) -> [[String: Any]] in
      // Fetch all assets sorted by creation time
      struct AssetData {
        let id: String; let time: Double; let width: Int; let height: Int
        var size: Int64; let mediaType: String; let duration: Double; let uri: String
        var pHash: UInt64
      }

      // First pass: collect all assets (fast — no file size yet)
      var rawAssets: [(asset: PHAsset, mediaType: String)] = []
      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)
        let typeStr = mediaType == 1 ? "photo" : "video"
        for i in 0..<fetchResult.count {
          rawAssets.append((asset: fetchResult.object(at: i), mediaType: typeStr))
        }
      }

      // Second pass: get file sizes + perceptual hashes concurrently
      var allAssets = Array<AssetData>(repeating: AssetData(id: "", time: 0, width: 0, height: 0, size: 0, mediaType: "", duration: 0, uri: "", pHash: 0), count: rawAssets.count)
      let lock = NSLock()
      let imageManager = PHImageManager.default()

      DispatchQueue.concurrentPerform(iterations: rawAssets.count) { i in
        let (asset, typeStr) = rawAssets[i]
        let resources = PHAssetResource.assetResources(for: asset)
        var totalSize: Int64 = 0
        for resource in resources {
          if let size = resource.value(forKey: "fileSize") as? Int64 { totalSize += size }
        }

        // Compute perceptual hash (8x8 grayscale → average → 64-bit hash)
        var hash: UInt64 = 0
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.deliveryMode = .fastFormat
        options.isNetworkAccessAllowed = false
        options.resizeMode = .fast
        let hashSize = CGSize(width: 8, height: 8)

        let sem = DispatchSemaphore(value: 0)
        imageManager.requestImage(for: asset, targetSize: hashSize, contentMode: .aspectFill, options: options) { image, _ in
          defer { sem.signal() }
          guard let img = image, let cgImage = img.cgImage else { return }

          // Get 8x8 pixel data
          let w = cgImage.width, h = cgImage.height
          guard w > 0 && h > 0 else { return }
          var pixels = [UInt8](repeating: 0, count: w * h * 4)
          guard let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
            bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
          ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))

          // Convert to grayscale values
          var grays = [Double]()
          for p in stride(from: 0, to: min(64 * 4, pixels.count), by: 4) {
            let gray = Double(pixels[p]) * 0.299 + Double(pixels[p+1]) * 0.587 + Double(pixels[p+2]) * 0.114
            grays.append(gray)
          }

          guard grays.count >= 64 else { return }

          // Average
          let avg = grays.reduce(0, +) / Double(grays.count)

          // Build hash: each bit = 1 if pixel > average
          var hashVal: UInt64 = 0
          for j in 0..<64 {
            if grays[j] > avg { hashVal |= (1 << j) }
          }
          hash = hashVal
        }
        sem.wait()

        let data = AssetData(
          id: asset.localIdentifier,
          time: (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
          width: asset.pixelWidth,
          height: asset.pixelHeight,
          size: totalSize,
          mediaType: typeStr,
          duration: asset.duration,
          uri: "ph://\(asset.localIdentifier)",
          pHash: hash
        )
        lock.lock()
        allAssets[i] = data
        lock.unlock()
      }

      // Filter out empty entries and sort by creation time
      allAssets = allAssets.filter { !$0.id.isEmpty }
      allAssets.sort { $0.time < $1.time }

      let timeWindow = Double(timeWindowMs)
      var used = Set<String>()
      var groups: [[String: Any]] = []
      var groupId = 0

      // Burst detection with sliding window
      var windowStart = 0
      for i in 0..<allAssets.count {
        while windowStart < i && allAssets[i].time - allAssets[windowStart].time > timeWindow {
          windowStart += 1
        }
        if used.contains(allAssets[i].id) { continue }
        var cluster: [Int] = [i]
        used.insert(allAssets[i].id)

        for j in windowStart..<allAssets.count {
          if j == i { continue }
          if allAssets[j].time - allAssets[i].time > timeWindow { break }
          if used.contains(allAssets[j].id) { continue }
          if allAssets[j].width == allAssets[i].width && allAssets[j].height == allAssets[i].height {
            // File size similarity check
            let sizeA = allAssets[i].size
            let sizeB = allAssets[j].size
            if sizeA > 0 && sizeB > 0 {
              let ratio = Double(min(sizeA, sizeB)) / Double(max(sizeA, sizeB))
              if ratio < minSizeRatio { continue }
            }
            // Perceptual hash similarity — Hamming distance ≤ 10 means visually similar
            let hashA = allAssets[i].pHash
            let hashB = allAssets[j].pHash
            if hashA != 0 && hashB != 0 {
              let hamming = (hashA ^ hashB).nonzeroBitCount
              if hamming > 10 { continue } // Too different visually
            }
            cluster.append(j)
            used.insert(allAssets[j].id)
          }
        }

        if cluster.count >= 2 {
          let assets: [[String: Any]] = cluster.map { idx in
            let a = allAssets[idx]
            return [
              "id": a.id,
              "mediaType": a.mediaType,
              "width": a.width,
              "height": a.height,
              "creationTime": a.time / 1000, // back to seconds
              "duration": a.duration,
              "fileSize": a.size,
              "uri": a.uri
            ]
          }
          groups.append([
            "id": "group-\(groupId)",
            "type": "burst",
            "assets": assets
          ])
          groupId += 1
        }
      }

      // Exact duplicates (same file size + dimensions, not in burst groups)
      let remaining = allAssets.filter { !used.contains($0.id) }
      var sizeMap: [String: [Int]] = [:]
      for (idx, asset) in remaining.enumerated() {
        if asset.size <= 0 { continue }
        let key = "\(asset.size)_\(asset.width)x\(asset.height)"
        sizeMap[key, default: []].append(idx)
      }

      for (_, indices) in sizeMap {
        if indices.count < 2 { continue }
        // Verify with pHash — only keep pairs that are visually similar
        let validIndices = indices.filter { idx in
          let a = remaining[idx]
          let ref = remaining[indices[0]]
          if a.pHash == 0 || ref.pHash == 0 { return true } // No hash — keep (benefit of doubt)
          return (a.pHash ^ ref.pHash).nonzeroBitCount <= 10
        }
        if validIndices.count < 2 { continue }
        let assets: [[String: Any]] = validIndices.map { idx in
          let a = remaining[idx]
          return [
            "id": a.id,
            "mediaType": a.mediaType,
            "width": a.width,
            "height": a.height,
            "creationTime": a.time / 1000,
            "duration": a.duration,
            "fileSize": a.size,
            "uri": a.uri
          ]
        }
        groups.append([
          "id": "group-\(groupId)",
          "type": "exact",
          "assets": assets
        ])
        groupId += 1
      }

      return groups
    }
  }
}
