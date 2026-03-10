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

        // Sum all resources (handles Live Photos: photo + video component)
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
      let options = PHFetchOptions()
      options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

      var allAssets: [PHAsset] = []

      for mediaType in mediaTypes {
        let type: PHAssetMediaType = mediaType == 1 ? .image : .video
        let fetchResult = PHAsset.fetchAssets(with: type, options: options)
        for i in 0..<fetchResult.count {
          allAssets.append(fetchResult.object(at: i))
        }
      }

      // Get file sizes from metadata (no image loading)
      var assetsWithSize: [(id: String, size: Int64)] = []
      for asset in allAssets {
        let resources = PHAssetResource.assetResources(for: asset)
        var totalSize: Int64 = 0
        for resource in resources {
          if let size = resource.value(forKey: "fileSize") as? Int64 {
            totalSize += size
          }
        }
        // Skip iCloud-only assets with no local size info
        if totalSize > 0 {
          assetsWithSize.append((id: asset.localIdentifier, size: totalSize))
        }
      }

      // Sort by size descending
      assetsWithSize.sort { $0.size > $1.size }

      // Return top 500
      let top = assetsWithSize.prefix(500)
      return top.map { ["id": $0.id, "fileSize": $0.size] }
    }
  }
}
