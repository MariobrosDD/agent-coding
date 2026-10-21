---
name: data-ml
description: Data engineering and machine learning: pandas/Polars/DuckDB, SQL analytics, ETL pipelines, Spark, notebooks, feature engineering, training and evaluating models (scikit-learn, PyTorch, TensorFlow/Keras, JAX, XGBoost/LightGBM), LLM applications, experiment tracking and reproducibility.
---
# Data and machine learning

## Data
- Look at the data before transforming it: schema, dtypes, nulls, ranges, duplicates, units, time zones, encodings. Print shapes and samples; state assumptions.
- Validate data at pipeline boundaries (pandera, Great Expectations, pydantic) and fail loudly on schema drift.
- Pipelines are idempotent and restartable; partition by date; never mutate raw data — write new outputs.
- pandas: no chained assignment or row loops; vectorize; mind copies vs views; categorical/Arrow dtypes for memory; Polars or DuckDB for large data.
- Timezone-aware datetimes with explicit formats.

## Machine learning
- Define the objective, the metric and a simple baseline first (heuristic or linear model). Ask the user what success means if it is unclear.
- Split before fitting anything; no leakage (fit scalers/encoders on train only, group- or time-based splits where appropriate, no future information in features).
- Cross-validation for small data; a final held-out test set used once.
- Report metrics with variance across seeds or confidence intervals; check per-segment performance and calibration; inspect errors.
- Reproducibility: seeds for Python, NumPy and the framework; deterministic flags where possible; pinned environment; config files; experiment tracking (MLflow, Weights & Biases); data versioning (DVC).
- PyTorch: model.train()/eval(), torch.no_grad() or inference_mode for inference, explicit device handling, gradient clipping where needed, NaN checks, and an overfit-one-batch sanity test before full training.
- Estimate runtime, memory and cost before long training jobs, tell the user, and run them as background jobs.
- Notebooks for exploration only; reusable logic in importable modules; strip outputs that contain secrets.
- LLM applications: evaluate with a test set, handle timeouts and failures, defend against prompt injection, avoid sending secrets or PII.
