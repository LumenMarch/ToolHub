// 图片 OCR — 基于 macOS Vision 框架（VNRecognizeTextRequest）
// 用法：swiftc -O ocr-image.swift -o ocr-image && ./ocr-image <图片路径> [语言]
// 语言默认 zh-Hans（简体中文，兼容英文/数字）；可传 en-US 等。
// 输出为「整页文本 + 每个识别行(带置信度)」两段，便于坐标级分析。
import Foundation
import Vision
import AppKit

struct OcrRun {
  let text: String
  let lines: [(text: String, confidence: Float, y: CGFloat)]
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

  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
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

  // 按视觉位置从上到下、再从左到右排序（Vision 坐标原点在左下）
  let sorted = observations.sorted { a, b in
    let ay = a.boundingBox.midY
    let by = b.boundingBox.midY
    if abs(ay - by) > 0.01 { return ay > by }
    return a.boundingBox.minX < b.boundingBox.minX
  }

  let lines = sorted.compactMap { o -> (String, Float, CGFloat)? in
    guard let c = o.topCandidates(1).first else { return nil }
    return (c.string, c.confidence, o.boundingBox.midY)
  }

  print("===== 整页文本 =====")
  print(lines.map { $0.0 }.joined(separator: "\n"))
  print("\n===== 识别行（按位置）=====")
  for (i, l) in lines.enumerated() {
    print(String(format: "[%03d] conf=%.3f y=%.3f  %@", i, l.1, l.2, l.0))
  }
}

main()