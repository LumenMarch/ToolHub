// 图片 OCR — 基于 macOS Vision 框架（VNRecognizeTextRequest）
// 用法：swiftc -O ocr-image.swift -o ocr-image && ./ocr-image <图片路径> [语言]
// 语言默认 zh-Hans（简体中文，兼容英文/数字）；可传 en-US 等。
// 输出为「整页文本 + 每个识别行(带置信度)」两段，便于坐标级分析。
import Foundation
import Vision
import AppKit
import ImageIO
import UniformTypeIdentifiers

struct OcrRun {
  let text: String
  let lines: [(text: String, confidence: Float, y: CGFloat)]
}

/// 从图片文件读取 EXIF 方向（kCGImagePropertyOrientation），无元数据时按 .up 处理。
func imageOrientation(of path: String) -> CGImagePropertyOrientation {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
        let raw = props[kCGImagePropertyOrientation] as? UInt32,
        let orientation = CGImagePropertyOrientation(rawValue: raw) else {
    return .up
  }
  return orientation
}

func main() {
  let args = CommandLine.arguments
  guard args.count >= 2 else {
    FileHandle.standardError.write(Data("用法: ocr-image <图片路径> [zh-Hans|en-US]\n".utf8))
    exit(2)
  }
  let path = args[1]
  let lang = args.count >= 3 ? args[2] : "zh-Hans"

  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("无法读取图片: \(path)\n".utf8))
    exit(1)
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = [lang]
  request.minimumTextHeight = 0.01

  // NSImage→CGImage 会丢失 EXIF 方向，需显式传给 Vision 以正确识别旋转拍摄的照片
  let handler = VNImageRequestHandler(cgImage: cg, orientation: imageOrientation(of: path), options: [:])
  do {
    try handler.perform([request])
  } catch {
    FileHandle.standardError.write(Data("识别失败: \(error)\n".utf8))
    exit(1)
  }

  guard let observations = request.results else {
    print("(无识别结果)")
    return
  }

  // 行分组：垂直方向有重叠（IoU 比例）的文本框归为同一行；行间自上而下、行内自左而右。
  // 不再用固定 midY 阈值，避免密集页面相邻行被交错排序。
  struct Item {
    let obs: VNRecognizedTextObservation
    let minY: CGFloat
    let maxY: CGFloat
    let minX: CGFloat
  }
  let items = observations.map { o in
    let b = o.boundingBox
    return Item(obs: o, minY: b.minY, maxY: b.maxY, minX: b.minX)
  }
  var rowGroups: [[Item]] = []
  for it in items.sorted(by: { $0.minY > $1.minY }) {
    var placed = false
    for gi in rowGroups.indices {
      let top = rowGroups[gi].map { $0.maxY }.max() ?? 0
      let bottom = rowGroups[gi].map { $0.minY }.min() ?? 0
      let overlap = min(top, it.maxY) - max(bottom, it.minY)
      let shorter = min(top - bottom, it.maxY - it.minY)
      if shorter > 0 && overlap / shorter > 0.5 {
        rowGroups[gi].append(it)
        placed = true
        break
      }
    }
    if !placed { rowGroups.append([it]) }
  }

  let sortedItems = rowGroups.flatMap { group in group.sorted(by: { $0.minX < $1.minX }) }
  let lines = sortedItems.compactMap { item -> (String, Float, CGFloat)? in
    guard let c = item.obs.topCandidates(1).first else { return nil }
    return (c.string, c.confidence, (item.minY + item.maxY) / 2)
  }

  print("===== 整页文本 =====")
  print(lines.map { $0.0 }.joined(separator: "\n"))
  print("\n===== 识别行（按位置）=====")
  for (i, l) in lines.enumerated() {
    print(String(format: "[%03d] conf=%.3f y=%.3f  %@", i, l.1, l.2, l.0))
  }
}

main()