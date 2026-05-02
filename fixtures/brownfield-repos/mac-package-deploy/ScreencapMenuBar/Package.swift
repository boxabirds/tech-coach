// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ScreencapMenuBar",
  targets: [
    .executableTarget(name: "ScreencapMenuBar"),
    .testTarget(name: "ScreencapMenuBarTests", dependencies: ["ScreencapMenuBar"])
  ]
)
