---
name: mobile
description: Mobile apps: iOS (Swift, SwiftUI, UIKit), Android (Kotlin, Jetpack Compose), cross-platform (React Native/Expo, Flutter, .NET MAUI, Kotlin Multiplatform), offline support, app lifecycle, permissions, secure storage, store requirements.
---
# Mobile development

- Identify the target platforms, minimum OS versions and framework versions first; APIs and lifecycles differ per version.
- Lifecycle: handle backgrounding, process death and state restoration (Android) and the scene lifecycle (iOS); never assume the app stays alive.
- UI on the main thread only; network and disk work off it (coroutines/Flow, Swift concurrency, isolates). Profile to avoid jank.
- Offline and flaky networks: timeouts, retries, caching, optimistic updates with conflict handling; local persistence (Room, SwiftData/Core Data, SQLite).
- Permissions requested just in time with a rationale; denial handled gracefully.
- Tokens in secure storage (Keychain, Android Keystore); certificate pinning only with a rotation plan; no secrets in the app binary.
- Accessibility: Dynamic Type/font scaling, VoiceOver/TalkBack labels, touch target sizes, contrast. Screen sizes, dark mode, RTL and localization.
- Battery and data: batch background work (WorkManager, BGTaskScheduler).
- Build tooling: Gradle/AGP, CocoaPods/SPM, Expo config. Never change signing, bundle IDs or store settings without asking.
- Tests: unit tests for view models and logic; UI tests (Compose testing, Espresso, XCUITest, Detox/Maestro, Flutter widget and integration tests). You usually cannot run a simulator here: build and unit-test, then tell the user what to try on a device.
