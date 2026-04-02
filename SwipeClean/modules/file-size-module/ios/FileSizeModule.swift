import ExpoModulesCore
import Photos

public class FileSizeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FileSizeModule")

    AsyncFunction("getFileSizes") { (localIdentifiers: [String]) -> [[String: Any]] in
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
      var results: [[String: Any]] = []

      for i in 0..<fetchResult.count {
        let asset = fetchResult.object(at: i)
        let resources = PHAssetResource.assetResources(for: asset)

        var totalSize: Int64 = 0
        for resource in resources {
          if let size = resource.value(forKey: "fileSize") as? Int64 {
            totalSize += size
          }
        }

        results.append([
          "id": asset.localIdentifier,
          "fileSize": totalSize
        ])
      }

      return results
    }

    AsyncFunction("getAllFileSizesSorted") { (mediaTypes: [Int]) -> [[String: Any]] in
      // Process in batches to avoid blocking the main thread for too long
      var allAssetsWithSize: [(id: String, size: Int64)] = []

      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)

        // Process in batches of 200
        let batchSize = 200
        for batchStart in stride(from: 0, to: fetchResult.count, by: batchSize) {
          let batchEnd = min(batchStart + batchSize, fetchResult.count)
          for i in batchStart..<batchEnd {
            let asset = fetchResult.object(at: i)
            let resources = PHAssetResource.assetResources(for: asset)
            var totalSize: Int64 = 0
            for resource in resources {
              if let size = resource.value(forKey: "fileSize") as? Int64 {
                totalSize += size
              }
            }
            // Include even iCloud assets — estimate from pixel dimensions if no local size
            if totalSize > 0 {
              allAssetsWithSize.append((id: asset.localIdentifier, size: totalSize))
            } else {
              // Estimate: ~3 bytes per pixel for photos, ~10 bytes per pixel per second for video
              let pixels = Int64(asset.pixelWidth) * Int64(asset.pixelHeight)
              let estimated: Int64
              if asset.mediaType == .video {
                estimated = pixels * Int64(max(asset.duration, 1)) * 2
              } else {
                estimated = pixels * 3
              }
              if estimated > 0 {
                allAssetsWithSize.append((id: asset.localIdentifier, size: estimated))
              }
            }
          }
        }
      }

      // Sort by size descending
      allAssetsWithSize.sort { $0.size > $1.size }

      // Return top 500
      let top = allAssetsWithSize.prefix(500)
      return top.map { ["id": $0.id, "fileSize": $0.size] }
    }
  }
}
