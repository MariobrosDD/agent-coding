---
name: scientific-computing
description: Numerical methods, simulation, physics and engineering models, astrodynamics and orbital mechanics, signal processing, HPC. Floating point, units, stability, validation against references, reproducibility. Python (NumPy/SciPy), Julia, Fortran, C++, MATLAB/Octave, R.
---
# Scientific and numerical computing

## Before writing code
- Write down the model: equations, assumptions, units, coordinate frames, reference epochs, valid ranges and required accuracy. Ask if they are not given.
- Find authoritative references (papers, textbooks, standards, NASA/JPL/ESA documentation) and cite them in comments next to each formula's implementation.
- Prefer well-tested libraries over hand-rolled numerics: NumPy/SciPy, Eigen, LAPACK/BLAS, SUNDIALS, PETSc, FFTW, GSL. Astrodynamics: SPICE (spiceypy), Astropy, Orekit, GMAT, poliastro/hapsira. Units: astropy.units, pint, Unitful.jl, mp-units.

## Floating point
- Never compare floats with ==. Use relative + absolute tolerances (`math.isclose`, `np.allclose(rtol=, atol=)`) derived from the problem's accuracy, and document them.
- Watch for catastrophic cancellation, accumulated rounding (pairwise/Kahan summation, `math.fsum`), overflow/underflow (work in log space), and ill-conditioning (check condition numbers; solve linear systems instead of inverting matrices).
- float64 by default; justify float32/float16. Detect and handle NaN/Inf explicitly at inputs and outputs.
- Angles: explicit degrees vs radians, normalized ranges, `atan2` instead of `atan`.

## Algorithms
- Choose integrators for the problem: stiff (Radau, BDF, LSODA) vs non-stiff (RK45, DOP853); symplectic integrators for long-term Hamiltonian dynamics; adaptive step control with stated tolerances. Check conservation of energy/momentum where applicable.
- Check stability conditions (CFL), convergence order (step/grid refinement must show the expected order) and sensitivity to parameters.
- Vectorize; avoid Python loops over large arrays; profile before optimizing; use Numba, Cython, JAX or compiled extensions for hot paths; MPI/OpenMP/CUDA only when needed and measured.

## Astrodynamics specifics
- Time scales: UTC, TAI, TT, TDB, GPS; leap seconds; Julian dates. Convert with SPICE or Astropy, never by hand.
- Frames: ICRF/J2000/GCRF, ITRF/ECEF, body-fixed, RTN/LVLH; precession, nutation and polar motion. State the frame and epoch of every state vector.
- Constants (μ, Earth radius, J2…) from a single authoritative, consistent source (IAU, WGS84, JPL DE ephemerides). Never mix sources.
- Validate propagators against known solutions: analytic two-body, published test cases, GMAT/STK/Orekit outputs.

## Verification, validation, reproducibility
- Verification (the code solves the equations correctly): analytic solutions, method of manufactured solutions, convergence tests, conservation laws, symmetry checks.
- Validation (the equations model reality): compare with experimental or reference data and state the error.
- Tests with explicit tolerances, golden reference data stored in the repo, and property-based tests (Hypothesis) for invariants.
- Fix and record random seeds; pin library versions (lockfile, environment.yml); record parameters and code version with every result.
- Separate data, parameters and code; no magic numbers — named constants with units and a source.

## Reporting
Report results with units, tolerance/uncertainty and the conditions under which they were obtained. Say what was verified and what was not.
