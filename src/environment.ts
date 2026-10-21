import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TOOLCHAINS: [label: string, command: string][] = [
  ["node", "node --version"],
  ["npm", "npm --version"],
  ["pnpm", "pnpm --version"],
  ["yarn", "yarn --version"],
  ["bun", "bun --version"],
  ["deno", "deno --version"],
  ["python", "python --version"],
  ["python3", "python3 --version"],
  ["uv", "uv --version"],
  ["conda", "conda --version"],
  ["go", "go version"],
  ["rustc", "rustc --version"],
  ["cargo", "cargo --version"],
  ["java", "java -version"],
  ["mvn", "mvn -v"],
  ["gradle", "gradle --version"],
  ["dotnet", "dotnet --version"],
  ["gcc", "gcc --version"],
  ["g++", "g++ --version"],
  ["clang", "clang --version"],
  ["gfortran", "gfortran --version"],
  ["cmake", "cmake --version"],
  ["make", "make --version"],
  ["julia", "julia --version"],
  ["R", "R --version"],
  ["php", "php --version"],
  ["ruby", "ruby --version"],
  ["swift", "swift --version"],
  ["flutter", "flutter --version"],
  ["docker", "docker --version"],
  ["kubectl", "kubectl version --client"],
  ["terraform", "terraform version"],
  ["git", "git --version"],
];

function probe(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { timeout: 6000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const text = `${stdout}\n${stderr}`;
      const version = text.match(/\d+\.\d+(\.\d+)?/);
      resolve(version ? version[0] : null);
    });
  });
}

/** Installed toolchains with their versions, e.g. ["node 24.19.0", "git 2.55.0"]. */
export async function detectToolchains(): Promise<string[]> {
  const found = await Promise.all(
    TOOLCHAINS.map(async ([label, cmd]) => {
      const version = await probe(cmd);
      return version ? `${label} ${version}` : null;
    }),
  );
  return found.filter((t): t is string => t !== null);
}

export interface ProjectInfo {
  /** Human-readable facts about the project, e.g. "Node.js (pnpm)", "frameworks: react, vite". */
  facts: string[];
  /** Best guess at a command that checks the project, or null. */
  verifyCommand: string | null;
}

const MARKERS: [file: string, label: string][] = [
  ["pyproject.toml", "Python (pyproject.toml)"],
  ["requirements.txt", "Python (requirements.txt)"],
  ["setup.py", "Python (setup.py)"],
  ["Pipfile", "Python (Pipfile)"],
  ["environment.yml", "Conda environment"],
  ["Cargo.toml", "Rust (Cargo)"],
  ["go.mod", "Go modules"],
  ["pom.xml", "Java/Kotlin (Maven)"],
  ["build.gradle", "Java/Kotlin (Gradle)"],
  ["build.gradle.kts", "Kotlin/Java (Gradle KTS)"],
  ["CMakeLists.txt", "C/C++ (CMake)"],
  ["meson.build", "C/C++ (Meson)"],
  ["Makefile", "Makefile"],
  ["platformio.ini", "Embedded (PlatformIO)"],
  ["composer.json", "PHP (Composer)"],
  ["Gemfile", "Ruby (Bundler)"],
  ["pubspec.yaml", "Dart/Flutter"],
  ["Package.swift", "Swift (SwiftPM)"],
  ["Project.toml", "Julia"],
  ["DESCRIPTION", "R package"],
  ["angular.json", "Angular"],
  ["Dockerfile", "Docker"],
  ["docker-compose.yml", "Docker Compose"],
  ["compose.yaml", "Docker Compose"],
  ["Chart.yaml", "Helm chart"],
  [".github/workflows", "GitHub Actions CI"],
  [".gitlab-ci.yml", "GitLab CI"],
  ["Jenkinsfile", "Jenkins CI"],
];

const FRAMEWORKS = [
  "react", "next", "vue", "nuxt", "svelte", "@sveltejs/kit", "@angular/core", "solid-js", "astro", "remix",
  "express", "fastify", "@nestjs/core", "koa", "hono", "electron", "react-native", "expo",
  "vite", "webpack", "typescript", "jest", "vitest", "mocha", "@playwright/test", "cypress",
  "eslint", "prettier", "prisma", "drizzle-orm", "typeorm", "mongoose", "three", "tailwindcss",
];

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function detectProject(root: string): ProjectInfo {
  const facts: string[] = [];
  let verifyCommand: string | null = null;
  const has = (rel: string) => fs.existsSync(path.join(root, rel));
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    // unreadable root: nothing to detect
  }

  if (has("package.json")) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; workspaces?: unknown } = {};
    try {
      pkg = JSON.parse(readText(path.join(root, "package.json")));
    } catch {
      facts.push("package.json (could not be parsed)");
    }
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    facts.push(`Node.js project (${pm}${pkg.workspaces || has("pnpm-workspace.yaml") ? ", monorepo workspaces" : ""})`);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const frameworks = FRAMEWORKS.filter((f) => f in deps).map((f) => `${f}@${deps[f]}`);
    if (frameworks.length) facts.push(`dependencies of note: ${frameworks.join(", ")}`);
    const scripts = pkg.scripts ?? {};
    if (Object.keys(scripts).length) facts.push(`npm scripts: ${Object.keys(scripts).join(", ")}`);
    const steps: string[] = [];
    const typecheck = ["typecheck", "type-check", "check-types", "tsc"].find((s) => s in scripts);
    if (typecheck) steps.push(`${pm} run ${typecheck}`);
    if ("lint" in scripts) steps.push(`${pm} run lint`);
    if (scripts.test && !/no test specified/.test(scripts.test)) steps.push(`${pm} test`);
    if (!steps.length && "build" in scripts) steps.push(`${pm} run build`);
    if (steps.length) verifyCommand = steps.join(" && ");
  }

  for (const [file, label] of MARKERS) if (has(file)) facts.push(label);
  const sln = entries.find((e) => /\.(sln|csproj|fsproj)$/.test(e));
  if (sln) facts.push(`.NET (${sln})`);
  if (entries.some((e) => e.endsWith(".tf"))) facts.push("Terraform");
  if (entries.some((e) => e.endsWith(".ipynb"))) facts.push("Jupyter notebooks");

  if (!verifyCommand) {
    const python = process.platform === "win32" ? "python" : "python3";
    const pyText = readText(path.join(root, "pyproject.toml")) + readText(path.join(root, "requirements.txt")) + readText(path.join(root, "requirements-dev.txt"));
    const makefile = readText(path.join(root, "Makefile"));
    if (has("Cargo.toml")) verifyCommand = "cargo build && cargo test";
    else if (has("go.mod")) verifyCommand = "go vet ./... && go test ./...";
    else if (sln) verifyCommand = "dotnet build && dotnet test";
    else if (has("pom.xml")) verifyCommand = "mvn -q -B test";
    else if (has("gradlew")) verifyCommand = "./gradlew test";
    else if (has("build.gradle") || has("build.gradle.kts")) verifyCommand = "gradle test";
    else if (/^test:/m.test(makefile)) verifyCommand = "make test";
    else if (/pytest/.test(pyText) || has("pytest.ini") || has("tests")) verifyCommand = `${python} -m pytest -q`;
    else if (has("pubspec.yaml")) verifyCommand = "flutter test";
    else if (has("CMakeLists.txt")) verifyCommand = "cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure";
  }
  return { facts, verifyCommand };
}
