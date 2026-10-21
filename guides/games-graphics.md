---
name: games-graphics
description: Game development and real-time graphics: Unity (C#), Unreal (C++/Blueprints), Godot (GDScript/C#), game loops, physics, ECS, networking, rendering pipelines, shaders (HLSL/GLSL/WGSL), WebGL/WebGPU/Three.js, Vulkan/OpenGL/DirectX/Metal.
---
# Games and real-time graphics

- Identify the engine and its version and follow its conventions (Unity MonoBehaviour lifecycle and serialization, Unreal UObject/GC rules and UPROPERTY, Godot nodes and signals).
- Game loop: fixed timestep for physics and simulation, variable timestep with interpolation for rendering; frame-rate-independent movement (scale by delta time); no per-frame allocations in managed engines (pool objects to avoid GC spikes).
- Determinism for lockstep networking and replays: fixed update order, seeded RNG, fixed-point or carefully controlled floating point.
- Physics in the physics step (FixedUpdate / _physics_process), input sampled per frame; collision layers and masks.
- Frame budget (16.6 ms at 60 FPS, 11.1 ms at 90 FPS for VR): profile with the engine profiler, RenderDoc, PIX or Nsight; batch draw calls, instancing, LODs, culling, texture compression and atlases.
- Shaders: precision, divergent branching and texture-sampling cost; linear vs gamma color space; GPU capability differences.
- Low-level graphics APIs: enable validation layers / debug contexts; manage resource lifetimes and synchronization explicitly in Vulkan, DX12 and Metal.
- Engine-generated assets (scenes, prefabs, .meta/.uasset files) carry GUIDs and binary data: don't hand-edit them unless you understand the format; never break Unity .meta files.
- Test game logic separated from engine objects; use play-mode or functional tests where the engine supports them. You can't play the game: tell the user what to check.
