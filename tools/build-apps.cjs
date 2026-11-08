"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  crypto = require("node:crypto");
const os = require("node:os");
const root = path.resolve(__dirname, ".."),
  project = require("../project.json");
const args = process.argv.slice(2),
  mode = args[0] || "prepare";
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
function run(command, argv, options = {}) {
  const r = spawnSync(command, argv, { cwd: root, stdio: "inherit", ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(command + " failed: " + r.status);
}
if (!args.includes("--prepared")) {
  run(process.execPath, ["build.cjs"]);
  require("./build-app-client.cjs").buildAppClient();
}
const content = path.join(root, "build/app-client/content");
if (mode === "prepare") process.exit(0);
const delivery = path.join(
  root,
  "build",
  project.version,
  `ProjectGreed-${project.version}-${mode === "windows" ? "windows-x64" : "android"}`,
);
if (!delivery.startsWith(path.join(root, "build") + path.sep))
  throw Error("Output outside workspace build folder");
fs.mkdirSync(delivery, { recursive: true });
if (mode === "windows") {
  run("dotnet", [
    "build",
    "apps/windows/ProjectGreed.Client.csproj",
    "-c",
    "Release",
    "-o",
    delivery,
    "--verbosity",
    "minimal",
  ]);
  const resolved = JSON.parse(
    fs.readFileSync(path.join(root, "apps/windows/obj/project.assets.json"), "utf8"),
  );
  const sdkLibrary = Object.keys(resolved.libraries).find((name) =>
    name.startsWith("Microsoft.Web.WebView2/"),
  );
  const sdkDirectory = Object.keys(resolved.packageFolders)
    .map((base) => path.join(base, resolved.libraries[sdkLibrary].path))
    .find((dir) => fs.existsSync(path.join(dir, "LICENSE.txt")));
  if (!sdkDirectory) throw Error("Missing WebView2 redistribution notices");
  for (const name of ["LICENSE.txt", "NOTICE.txt"])
    fs.copyFileSync(path.join(sdkDirectory, name), path.join(delivery, "WebView2-" + name));
  const destination = path.join(delivery, "content");
  // The resolved target is checked before removing an old generated content tree.
  if (
    destination !==
    path.resolve(root, "build", project.version, `ProjectGreed-${project.version}-windows-x64`, "content")
  )
    throw Error("Unsafe content destination");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(content, destination, { recursive: true });
} else if (mode === "android") {
  let config = {};
  const configFile = path.join(root, "apps/toolchain.local.json");
  if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const sdk =
    option("--sdk") ||
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    config.androidSdk;
  const jdk = option("--java") || process.env.JAVA_HOME || config.javaHome;
  const gradle = option("--gradle") || process.env.GRADLE_HOME || config.gradleHome;
  if (!sdk || !jdk || !gradle)
    throw Error(
      "Set ANDROID_HOME, JAVA_HOME and GRADLE_HOME, or apps/toolchain.local.json (see docs/tools/native-clients.md)",
    );
  const sdkPath = path.resolve(sdk);
  if (!fs.existsSync(path.join(sdkPath, "platforms", "android-36", "android.jar")))
    throw Error("Android SDK platform 36 missing");
  fs.writeFileSync(
    path.join(root, "apps/android/local.properties"),
    "sdk.dir=" + sdkPath.replaceAll("\\", "/").replace(":", "\\:") + "\n",
  );
  const java = path.join(jdk, "bin", process.platform === "win32" ? "java.exe" : "java");
  run(
    java,
    [
      "-classpath",
      path.join(gradle, "lib", "*"),
      "org.gradle.launcher.GradleMain",
      "-p",
      "apps/android",
      "assembleDebug",
      "-PprojectGreedDebugKeystore=" +
        path.join(process.env.USERPROFILE || os.homedir(), ".android", "debug.keystore"),
      ...(args.includes("--with-tests") ? ["assembleDebugAndroidTest", "testDebugUnitTest"] : []),
      "--console=plain",
    ],
    { env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdkPath } },
  );
  fs.copyFileSync(
    path.join(root, "apps/android/app/build/outputs/apk/debug/app-debug.apk"),
    path.join(delivery, `ProjectGreed-${project.version}.apk`),
  );
} else throw Error("Unknown target: " + mode);
const records = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.name !== "distribution-manifest.json") {
      const data = fs.readFileSync(file);
      records.push({
        path: path.relative(delivery, file).replaceAll("\\", "/"),
        bytes: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
scan(delivery);
fs.writeFileSync(
  path.join(delivery, "distribution-manifest.json"),
  JSON.stringify(
    { edition: "ProjectGreed", version: project.version, platform: mode, files: records },
    null,
    2,
  ),
);
console.log("Native client: " + delivery);
