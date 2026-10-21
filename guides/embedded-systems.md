---
name: embedded-systems
description: Microcontroller firmware, RTOS, device drivers, bare-metal C/C++/Rust, interrupts, DMA, memory-mapped I/O, buses (UART, SPI, I2C, CAN, USB), power and timing constraints, bootloaders, cross-compilation and hardware testing.
---
# Embedded and firmware development

Know the target first: MCU/SoC part number, core, clock, RAM/flash sizes, toolchain (arm-none-eabi-gcc, IAR, Keil, ESP-IDF, Zephyr, PlatformIO, STM32Cube), RTOS (FreeRTOS, Zephyr, ThreadX, RTEMS) or bare metal, and the datasheet/reference manual. Read the relevant register, timing and errata sections before writing driver code; ask the user for them if they are not in the repo.

## Rules
- `volatile` for memory-mapped registers and variables shared with ISRs — it does not make anything atomic.
- ISRs: short, never block, no heap, no printf; defer work to tasks through queues/flags; clear interrupt flags correctly; mind priorities and nesting.
- Data shared between ISRs and tasks: brief critical sections, atomics (C11 stdatomic, CMSIS intrinsics), or single-producer/single-consumer ring buffers with clear ownership.
- No dynamic allocation after initialization (static pools). Know stack sizes and measure them (stack painting, high-water marks).
- Fixed-width types (`uint32_t`), explicit casts, overflow checks; avoid floating point in ISRs and on cores without an FPU unless justified.
- Named masks/macros or vendor/SVD-generated register headers for bit manipulation; beware read-modify-write races on shared registers.
- A timeout on every hardware wait loop; a watchdog serviced only from a healthy main loop.
- Handle peripheral errors (bus errors, NACK, overrun, CRC) and log the reset cause (brown-out, watchdog, software).
- Define endianness, packing and alignment when serializing; never memcpy structs onto the wire without a defined layout.
- Power: sleep modes, clock gating; debounce inputs.
- Follow MISRA C / CERT C where the project requires it; for flight, medical or automotive firmware also load the safety-critical guide.

## Architecture
- A hardware abstraction layer separates drivers from application logic so logic can be unit-tested on the host (Unity/CMock, Ceedling, GoogleTest, Rust `#[cfg(test)]`).
- Explicit, tested state machines for protocols and operating modes.
- Firmware updates: integrity (CRC/signature), A/B slots, rollback.

## Verification
- Build with -Wall -Wextra -Werror (plus -fstack-usage); review the map file for size; static analysis (cppcheck, clang-tidy, PC-lint).
- Host-side unit tests with mocked hardware; HIL tests when hardware is available; timing checks with a logic analyzer, oscilloscope or trace (SWO/ETM).
- You normally cannot flash or probe the hardware: compile, run host tests and static checks, and tell the user exactly what to test on the device.
