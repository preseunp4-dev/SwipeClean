import ExpoModulesCore
import Photos
import Vision
import CoreImage

public class PhotoQualityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoQualityModule")

    AsyncFunction("analyzePhotos") { (localIdentifiers: [String]) -> [[String: Any]] in
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
      var results: [[String: Any]] = []
      let imageManager = PHImageManager.default()
      let requestOptions = PHImageRequestOptions()
      requestOptions.isSynchronous = true
      requestOptions.deliveryMode = .highQualityFormat
      requestOptions.isNetworkAccessAllowed = false // Don't download from iCloud
      // Use a smaller target size for faster analysis
      let targetSize = CGSize(width: 800, height: 800)

      for i in 0..<fetchResult.count {
        let asset = fetchResult.object(at: i)
        var result: [String: Any] = [
          "id": asset.localIdentifier,
          "sharpness": 0.5,
          "exposure": 0.5,
          "facesDetected": 0,
          "eyesOpen": false,
          "smiling": false,
          "faceQuality": 0.0,
          "compositeScore": 50.0
        ]

        // Request image for analysis
        let semaphore = DispatchSemaphore(value: 0)
        imageManager.requestImage(for: asset, targetSize: targetSize, contentMode: .aspectFit, options: requestOptions) { image, info in
          defer { semaphore.signal() }
          guard let cgImage = image?.cgImage else { return }

          // 1. Sharpness (Laplacian variance)
          let sharpness = self.calculateSharpness(cgImage)
          result["sharpness"] = sharpness

          // 2. Exposure (brightness histogram)
          let exposure = self.calculateExposure(cgImage)
          result["exposure"] = exposure

          // 3. Face detection with landmarks
          let faceResults = self.analyzeFaces(cgImage)
          result["facesDetected"] = faceResults.faceCount
          result["eyesOpen"] = faceResults.eyesOpen
          result["smiling"] = faceResults.smiling
          result["faceQuality"] = faceResults.quality

          // 4. Composite score
          let resolution = Double(asset.pixelWidth * asset.pixelHeight)
          let resolutionScore = min(resolution / 12_000_000.0, 1.0) // Normalize to 12MP

          // Get file size
          let resources = PHAssetResource.assetResources(for: asset)
          var fileSize: Int64 = 0
          for resource in resources {
            if let size = resource.value(forKey: "fileSize") as? Int64 {
              fileSize += size
            }
          }
          let fileSizeScore = min(Double(fileSize) / 10_000_000.0, 1.0) // Normalize to 10MB

          // Exposure score: distance from ideal (0.5)
          let exposureScore = 1.0 - abs(exposure - 0.5) * 2.0

          // Composite: weighted average
          var composite = 0.0
          composite += sharpness * 30        // Sharpness is most important
          composite += exposureScore * 15    // Good exposure matters
          composite += resolutionScore * 10  // Higher res is better
          composite += fileSizeScore * 10    // Larger file = more detail

          // Face bonus
          if faceResults.faceCount > 0 {
            composite += faceResults.quality * 10  // Face quality (size/clarity)
            if faceResults.eyesOpen { composite += 12 } else { composite -= 5 } // Eyes open/closed
            if faceResults.smiling { composite += 13 } else { composite -= 3 }  // Smiling/not
          } else {
            // No faces — redistribute face points to sharpness/exposure
            composite += sharpness * 20
            composite += exposureScore * 15
          }

          result["compositeScore"] = min(composite, 100.0)
        }
        semaphore.wait()
        results.append(result)
      }

      return results
    }
  }

  // MARK: - Sharpness (Laplacian variance)
  private func calculateSharpness(_ cgImage: CGImage) -> Double {
    let ciImage = CIImage(cgImage: cgImage)
    let context = CIContext()

    // Apply Laplacian filter for edge detection
    guard let filter = CIFilter(name: "CIConvolution3X3") else { return 0.5 }
    // Laplacian kernel
    let weights: [CGFloat] = [0, 1, 0, 1, -4, 1, 0, 1, 0]
    filter.setValue(ciImage, forKey: kCIInputImageKey)
    filter.setValue(CIVector(values: weights, count: 9), forKey: "inputWeights")
    filter.setValue(0, forKey: "inputBias")

    guard let outputImage = filter.outputImage else { return 0.5 }

    // Calculate statistics on the filtered image
    var bitmap = [UInt8](repeating: 0, count: 4)
    // Sample center region for speed
    let extent = outputImage.extent
    let sampleRect = CGRect(
      x: extent.midX - 100,
      y: extent.midY - 100,
      width: min(200, extent.width),
      height: min(200, extent.height)
    )

    guard let statFilter = CIFilter(name: "CIAreaAverage", parameters: [
      kCIInputImageKey: outputImage,
      kCIInputExtentKey: CIVector(cgRect: sampleRect)
    ]), let statOutput = statFilter.outputImage else { return 0.5 }

    context.render(statOutput, toBitmap: &bitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())

    // Higher average = more edges = sharper
    let avg = (Double(bitmap[0]) + Double(bitmap[1]) + Double(bitmap[2])) / (3.0 * 255.0)
    // Normalize: typical range is 0.01-0.15, map to 0-1
    return min(avg / 0.12, 1.0)
  }

  // MARK: - Exposure (average brightness)
  private func calculateExposure(_ cgImage: CGImage) -> Double {
    let ciImage = CIImage(cgImage: cgImage)
    let context = CIContext()

    guard let filter = CIFilter(name: "CIAreaAverage", parameters: [
      kCIInputImageKey: ciImage,
      kCIInputExtentKey: CIVector(cgRect: ciImage.extent)
    ]), let output = filter.outputImage else { return 0.5 }

    var bitmap = [UInt8](repeating: 0, count: 4)
    context.render(output, toBitmap: &bitmap, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())

    // Convert to brightness (0-1)
    let brightness = (Double(bitmap[0]) * 0.299 + Double(bitmap[1]) * 0.587 + Double(bitmap[2]) * 0.114) / 255.0
    return brightness
  }

  // MARK: - Face analysis
  private struct FaceAnalysisResult {
    var faceCount: Int = 0
    var eyesOpen: Bool = false
    var smiling: Bool = false
    var quality: Double = 0.0
  }

  private func analyzeFaces(_ cgImage: CGImage) -> FaceAnalysisResult {
    var result = FaceAnalysisResult()

    // Face landmarks request (includes eye/mouth detection)
    let faceLandmarksRequest = VNDetectFaceLandmarksRequest()
    // Face quality request
    let faceQualityRequest = VNDetectFaceCaptureQualityRequest()

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([faceLandmarksRequest, faceQualityRequest])

    guard let faceObservations = faceLandmarksRequest.results, !faceObservations.isEmpty else {
      return result
    }

    result.faceCount = faceObservations.count

    // Analyze the largest/most prominent face
    let sortedFaces = faceObservations.sorted { $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height }
    let primaryFace = sortedFaces[0]

    // Eye detection: check if eyes are open based on landmark positions
    if let landmarks = primaryFace.landmarks {
      // If we have eye landmarks, eyes are likely open (closed eyes have different patterns)
      if landmarks.leftEye != nil && landmarks.rightEye != nil {
        // Check eye openness by comparing eye height to width ratio
        if let leftEye = landmarks.leftEye, let rightEye = landmarks.rightEye {
          let leftOpenness = self.eyeOpenness(leftEye)
          let rightOpenness = self.eyeOpenness(rightEye)
          result.eyesOpen = leftOpenness > 0.15 && rightOpenness > 0.15
        }
      }

      // Smile detection: check mouth shape
      if let outerLips = landmarks.outerLips, let innerLips = landmarks.innerLips {
        let smileScore = self.smileScore(outerLips: outerLips, innerLips: innerLips)
        result.smiling = smileScore > 0.3
      }
    }

    // Face quality from VNDetectFaceCaptureQualityRequest
    if let qualityResults = faceQualityRequest.results, !qualityResults.isEmpty {
      // Average quality across all faces
      let totalQuality = qualityResults.reduce(0.0) { $0 + Double($1.faceCaptureQuality ?? 0) }
      result.quality = totalQuality / Double(qualityResults.count)
    }

    return result
  }

  private func eyeOpenness(_ eye: VNFaceLandmarkRegion2D) -> Double {
    let points = eye.normalizedPoints
    guard points.count >= 4 else { return 0.5 }

    // Calculate vertical span vs horizontal span
    let ys = points.map { $0.y }
    let xs = points.map { $0.x }
    let height = (ys.max() ?? 0) - (ys.min() ?? 0)
    let width = (xs.max() ?? 0) - (xs.min() ?? 0)
    guard width > 0 else { return 0.5 }
    return Double(height / width)
  }

  private func smileScore(outerLips: VNFaceLandmarkRegion2D, innerLips: VNFaceLandmarkRegion2D) -> Double {
    let outerPoints = outerLips.normalizedPoints
    let innerPoints = innerLips.normalizedPoints
    guard outerPoints.count >= 6 else { return 0.0 }

    // Smile = mouth corners higher than center + wider mouth
    let xs = outerPoints.map { $0.x }
    let width = (xs.max() ?? 0) - (xs.min() ?? 0)

    // Check if corners are higher than center bottom
    let leftCorner = outerPoints[0]
    let rightCorner = outerPoints[outerPoints.count / 2]
    let bottomCenter = outerPoints.min { $0.y < $1.y } ?? outerPoints[0]

    let cornerAvgY = (leftCorner.y + rightCorner.y) / 2.0
    let curvature = Double(cornerAvgY - bottomCenter.y)

    // Wider mouth + upward curvature = smile
    return max(0, curvature * 5.0 + Double(width) * 0.5)
  }
}
