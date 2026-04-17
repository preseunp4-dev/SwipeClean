import ExpoModulesCore
import Photos
import Vision
import CoreImage

public class PhotoQualityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoQualityModule")

    AsyncFunction("analyzePhotos") { (localIdentifiers: [String]) -> [[String: Any]] in
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
      let count = fetchResult.count
      if count == 0 { return [] }

      // Pre-fetch all assets into array for concurrent access
      var assets: [PHAsset] = []
      for i in 0..<count { assets.append(fetchResult.object(at: i)) }

      // Thread-safe results array
      var results = Array<[String: Any]>(repeating: [:], count: count)
      let lock = NSLock()
      let imageManager = PHImageManager.default()
      // REDUCED from 600×600 to 300×300: 4× less memory per iteration.
      // Sharpness samples a 200×200 center crop, so 300 still has margin.
      // Vision face detection works fine at this resolution.
      let targetSize = CGSize(width: 300, height: 300)

      // Process photos concurrently across CPU cores, but wrap each
      // iteration in an autoreleasepool so per-photo CoreImage/Vision
      // allocations are released immediately instead of piling up until
      // the whole batch completes. That pile-up was what caused the
      // hard crashes on Duplicates-tab open.
      DispatchQueue.concurrentPerform(iterations: count) { i in
        autoreleasepool {
          let asset = assets[i]
          var result: [String: Any] = [
            "id": asset.localIdentifier,
            "sharpness": 0.5, "exposure": 0.5,
            "facesDetected": 0, "eyesOpen": false, "smiling": false,
            "faceQuality": 0.0, "compositeScore": 50.0
          ]

          let options = PHImageRequestOptions()
          options.isSynchronous = true
          options.deliveryMode = .fastFormat
          options.isNetworkAccessAllowed = false
          options.resizeMode = .fast

          let semaphore = DispatchSemaphore(value: 0)
          imageManager.requestImage(for: asset, targetSize: targetSize, contentMode: .aspectFit, options: options) { image, _ in
            defer { semaphore.signal() }
            guard let cgImage = image?.cgImage else { return }

            let sharpness = self.calculateSharpness(cgImage)
            let exposure = self.calculateExposure(cgImage)
            let faceResults = self.analyzeFaces(cgImage)

            result["sharpness"] = sharpness
            result["exposure"] = exposure
            result["facesDetected"] = faceResults.faceCount
            result["eyesOpen"] = faceResults.eyesOpen
            result["smiling"] = faceResults.smiling
            result["faceQuality"] = faceResults.quality

            let resolution = Double(asset.pixelWidth * asset.pixelHeight)
            let resolutionScore = min(resolution / 12_000_000.0, 1.0)
            let exposureScore = 1.0 - abs(exposure - 0.5) * 2.0

            // Note: dropped the PHAssetResource fileSize lookup here — it
            // was adding a per-photo PHAssetResource call (more memory
            // pressure) for a small composite-score contribution.
            var composite = sharpness * 30 + exposureScore * 15 + resolutionScore * 15
            if faceResults.faceCount > 0 {
              composite += faceResults.quality * 10
              composite += faceResults.eyesOpen ? 12 : -5
              composite += faceResults.smiling ? 13 : -3
              if faceResults.obstructed { composite -= 15 }
            } else {
              composite += sharpness * 20 + exposureScore * 15
            }
            result["compositeScore"] = min(composite, 100.0)
          }
          semaphore.wait()

          lock.lock()
          results[i] = result
          lock.unlock()
        }
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
    var obstructed: Bool = false
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

      // Obstruction detection: if nose or mouth landmarks are missing/incomplete,
      // or if face quality is very low despite face being detected, likely obstructed
      let hasNose = landmarks.nose != nil && (landmarks.nose?.pointCount ?? 0) >= 3
      let hasMouth = landmarks.outerLips != nil && (landmarks.outerLips?.pointCount ?? 0) >= 4
      let hasMedianLine = landmarks.medianLine != nil

      if !hasNose || !hasMouth || !hasMedianLine {
        result.obstructed = true
      }

      // Also check if face quality is unusually low for a detected face
      // This often indicates partial obstruction
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
