package io.projectgreed.apptest2;

import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import org.json.JSONObject;
import org.json.JSONArray;
import android.net.Uri;
import android.os.*;
import android.util.Base64;
import android.view.*;
import java.io.*;
import org.mozilla.geckoview.*;

/** Gecko is bundled in the APK; no Android System WebView provider is needed. */
public final class MainActivity extends Activity {
    private static GeckoRuntime runtime;
    private GeckoSession web;
    private GeckoPrompts prompts;
    private NativeAssetServer assets;
    private boolean clientStarted;
    private File pendingExport;
    private NativeStore store;
    private LocalArchive archive;
    private String storeEpoch = java.util.UUID.randomUUID().toString();
    private final Object storageLock = new Object();
    private SharedPreferences preferences;
    private String currentScene = "menu";
    private boolean choosingFolder, storagePromptOpen;
    private static final int PICK_STORAGE = 103;
    private static final int STORAGE_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        preferences = getSharedPreferences("native-client", MODE_PRIVATE);
        getWindow().setStatusBarColor(0xff152430);
        getWindow().setNavigationBarColor(0xff152430);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        if (saved != null) {
            choosingFolder = saved.getBoolean("choosingFolder", false);
            String pendingName = saved.getString("pendingExport");
            if (pendingName != null && pendingName.startsWith("pg-export-") && new File(pendingName).getName().equals(pendingName)) {
                File staged = new File(getCacheDir(), pendingName);
                if (staged.isFile()) pendingExport = staged;
            }
        }
        try {
            Bridge bridge = new Bridge();
            assets = new NativeAssetServer(name -> getAssets().open(name), (method, text) -> {
                JSONArray args = new JSONArray(text);
                switch (method) {
                    case "archive": return bridge.archive(args.getString(0));
                    case "read": return bridge.read();
                    case "commit": return bridge.commit(args.getString(0));
                    case "compatibilityResult": bridge.compatibilityResult(args.getString(0)); break;
                    case "sceneChanged": bridge.sceneChanged(args.getString(0),args.getBoolean(1)); break;
                    case "openStorageFolder": bridge.openStorageFolder(); break;
                    case "chooseStorageFolder": bridge.chooseStorageFolder(); break;
                    case "exit": bridge.exit(); break;
                    case "exportFile": bridge.exportFile(args.getString(0),args.getString(1),args.getString(2)); break;
                    default: throw new IOException("Unknown native method");
                }
                return "{\"ok\":true}";
            });
            if (runtime == null) runtime = GeckoRuntime.create(getApplicationContext(),new GeckoRuntimeSettings.Builder()
                .javaScriptEnabled(true).consoleOutput(BuildConfig.DEBUG).remoteDebuggingEnabled(BuildConfig.DEBUG).build());
            web = new GeckoSession(new GeckoSessionSettings.Builder().build());
            web.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
                @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession session, LoadRequest request) {
                    if (assets.isApp(request.uri)) return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                    if (request.hasUserGesture) openExternal(Uri.parse(request.uri));
                    return GeckoResult.fromValue(AllowOrDeny.DENY);
                }
                @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession session, String uri) {
                    return GeckoResult.fromValue(null);
                }
            });
            web.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
                @Override public GeckoResult<Integer> onContentPermissionRequest(GeckoSession session, ContentPermission permission) {
                    boolean media = permission.permission == PERMISSION_AUTOPLAY_AUDIBLE || permission.permission == PERMISSION_AUTOPLAY_INAUDIBLE;
                    return GeckoResult.fromValue(media && assets.isOrigin(permission.uri) ? ContentPermission.VALUE_ALLOW : ContentPermission.VALUE_DENY);
                }
            });
            web.setContentDelegate(new GeckoSession.ContentDelegate() {
                @Override public void onCrash(GeckoSession session) { alert("内置渲染进程异常，请重新打开客户端。已保存的数据会保留。"); }
                @Override public void onKill(GeckoSession session) { alert("系统因内存不足停止了渲染进程，请重新打开客户端。"); }
            });
            prompts = new GeckoPrompts(this); web.setPromptDelegate(prompts);
            web.open(runtime);
            GeckoView view = new GeckoView(this); view.setSession(web);
            android.widget.FrameLayout safeArea = new android.widget.FrameLayout(this);
            safeArea.addView(view,new android.widget.FrameLayout.LayoutParams(-1,-1));
            safeArea.setOnApplyWindowInsetsListener((v,insets)->{
                if(Build.VERSION.SDK_INT>=30){
                    android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                    android.graphics.Insets keyboard=insets.getInsets(WindowInsets.Type.ime());
                    v.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard.bottom));
                } else v.setPadding(0,0,0,0);
                return insets;
            });
            setContentView(safeArea);
            web.loadUri(assets.url("compatibility.html"));
        } catch(Exception error) { alert("内置 Gecko 内核启动失败："+error.getMessage()); }
    }
    private void openProfile() {
        String folder = preferences.getString("saveTree", null);
        archive = folder == null ? new LocalArchive(new File(getFilesDir(), "records")) : new LocalArchive(getContentResolver(), Uri.parse(folder));
        store = folder == null ? new NativeStore(new File(getFilesDir(), "profile"))
            : new NativeStore(new SnapshotFiles.Documents(getContentResolver(), Uri.parse(folder)), true, null);
    }
    private static String mime(String path) { return NativeAssetServer.mime(path); }
    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { }
    }
    private void alert(String text) {
        runOnUiThread(()->{
            if (!isFinishing() && !isDestroyed()) new AlertDialog.Builder(this).setMessage(text).setPositiveButton("确定",null).show();
        });
    }
    public final class Bridge {
        public void compatibilityResult(String result) {
            runOnUiThread(()->{
                if (clientStarted || isFinishing() || isDestroyed()) return;
                try {
                    org.json.JSONArray missing = new org.json.JSONArray(result);
                    if (missing.length() != 0) throw new IOException("内置 Gecko 内核缺少功能：" + missing);
                    openProfile(); clientStarted = true;
                    web.loadUri(assets.url("client.html"));
                } catch (Exception error) { alert("无法加载客户端：" + error.getMessage()); }
            });
        }
        public String archive(String value) { synchronized(storageLock) { return archive.request(value); } }
        public String read() {
            synchronized (storageLock) {
                try { return new JSONObject(store.read()).put("epoch", storeEpoch).toString(); }
                catch (Exception error) { return "{\"ok\":false,\"error\":\"无法读取应用存档\"}"; }
            }
        }
        public String commit(String value) {
            synchronized (storageLock) {
                try {
                    if (!storeEpoch.equals(new JSONObject(value).optString("epoch")))
                        return "{\"ok\":false,\"error\":\"存档位置已切换，请等待界面重新加载\"}";
                    return store.commit(value);
                } catch (Exception error) { return "{\"ok\":false,\"error\":\"存档请求无效\"}"; }
            }
        }
        public void sceneChanged(String scene, boolean ready) {
            runOnUiThread(()->{
                currentScene = scene;
                int orientation = "game".equals(scene) ? ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                if (getRequestedOrientation() != orientation) setRequestedOrientation(orientation);
                if (ready && "menu".equals(scene)) showStoragePrompt();
            });
        }
        public void openStorageFolder() { runOnUiThread(() -> {
            String folder = preferences.getString("saveTree", null);
            if (folder == null) { MainActivity.this.chooseStorageFolder(); return; }
            Uri tree = Uri.parse(folder);
            Uri directory = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, android.provider.DocumentsContract.getTreeDocumentId(tree));
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(directory, android.provider.DocumentsContract.Document.MIME_TYPE_DIR)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            try { startActivity(intent); } catch (ActivityNotFoundException error) { MainActivity.this.chooseStorageFolder(); }
        }); }
        public void chooseStorageFolder() { runOnUiThread(()->MainActivity.this.chooseStorageFolder()); }
        public void exit() { runOnUiThread(()->finish()); }
        public void exportFile(String name, String mime, String base64) {
            try {
                if (base64.length() > NativeStore.MAX_BYTES * 4L / 3L + 8) throw new IOException("导出文件过大");
                final byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length > NativeStore.MAX_BYTES) throw new IOException("导出文件过大");
                final File staged = File.createTempFile("pg-export-", ".tmp", getCacheDir());
                try (FileOutputStream output = new FileOutputStream(staged)) {
                    output.write(bytes); output.flush(); output.getFD().sync();
                } catch (Exception error) { staged.delete(); throw error; }
                runOnUiThread(()->{
                    if (pendingExport != null) { staged.delete(); alert("请先完成上一个导出操作"); return; }
                    pendingExport = staged;
                    String filename = new File(name.replace('\\','/')).getName();
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(mime == null || mime.isEmpty() ? "application/json" : mime.split(";")[0]).putExtra(Intent.EXTRA_TITLE, filename);
                    try { startActivityForResult(intent, 102); }
                    catch (ActivityNotFoundException error) { pendingExport = null; staged.delete(); alert("未找到系统文件保存界面"); }
                });
            } catch (Exception error) { alert("导出失败：" + error.getMessage()); }
        }
    }
    private void showStoragePrompt() {
        if (storagePromptOpen || choosingFolder || preferences.getBoolean("storagePromptSeen", false)) return;
        storagePromptOpen = true;
        new AlertDialog.Builder(this)
            .setMessage("将存档保存在其他文件夹可以避免意外丢失存档,要指定外置文件夹保存存档吗?")
            .setPositiveButton("选择文件夹", (d,w)->{
                preferences.edit().putBoolean("storagePromptSeen", true).commit();
                chooseStorageFolder();
            })
            .setNegativeButton("关闭", (d,w)->preferences.edit().putBoolean("storagePromptSeen", true).commit())
            .setOnDismissListener(d->storagePromptOpen = false).setCancelable(false).show();
    }
    private void chooseStorageFolder() {
        if (choosingFolder) return;
        if ("game".equals(currentScene)) { alert("请先返回主菜单再更改存档文件夹"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(STORAGE_FLAGS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String old = preferences.getString("saveTree", null);
        if (old != null) intent.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(old));
        try { choosingFolder = true; startActivityForResult(intent, PICK_STORAGE); }
        catch (Exception error) { choosingFolder = false; alert("无法选择文件夹：" + error.getMessage()); }
    }
    private void activateStorageFolder(Uri uri, int grantedFlags) {
        // Freeze the page while copying its current, acknowledged native snapshot. A reload
        // then rebuilds the synchronous JS view from the newly authoritative directory.
        assets.event("freeze", true);
        new Thread(()->{
            boolean acquired = false, activated = false;
            String old = preferences.getString("saveTree", null);
            try {
                if ((grantedFlags & STORAGE_FLAGS) != STORAGE_FLAGS) throw new IOException("请选择可读写的存档文件夹");
                getContentResolver().takePersistableUriPermission(uri, STORAGE_FLAGS); acquired = true;
                synchronized (storageLock) {
                    JSONObject seed = new JSONObject(store.read());
                    SnapshotFiles.Documents files = new SnapshotFiles.Documents(getContentResolver(), uri);
                    boolean existing = files.exists("profile.json") || files.exists("profile.previous.json");
                    if (!existing && !seed.optBoolean("ok")) throw new IOException("当前存档未能读取，请选择包含有效存档的原文件夹");
                    NativeStore next = new NativeStore(files, false, seed.optBoolean("ok") ? seed : null);
                    JSONObject checked = new JSONObject(next.read());
                    if (!checked.optBoolean("ok")) throw new IOException(checked.optString("error"));
                    next.ensureSaved();
                    if (!preferences.edit().putString("saveTree", uri.toString()).putBoolean("storagePromptSeen", true).commit())
                        throw new IOException("未能保存文件夹设置，仍使用原存档位置");
                    archive = new LocalArchive(getContentResolver(), uri);
                    store = next; storeEpoch = java.util.UUID.randomUUID().toString(); activated = true;
                    runOnUiThread(()->{
                        choosingFolder = false;
                        if (isFinishing() || isDestroyed()) return;
                        web.reload();
                        alert(existing ? "已使用所选文件夹中已有的存档。" : "存档已迁移至所选文件夹，后续将自动保存到这里。");
                    });
                }
            } catch (Exception error) {
                runOnUiThread(()->{
                    choosingFolder = false;
                    if (isFinishing() || isDestroyed()) return;
                    assets.event("freeze", false);
                    alert("未能切换存档文件夹，原存档位置保持不变：" + error.getMessage());
                });
            } finally {
                // Do not leak grants from rejected choices, or revoke the active directory.
                if (acquired && !activated && !uri.toString().equals(old))
                    try { getContentResolver().releasePersistableUriPermission(uri, STORAGE_FLAGS); } catch (Exception ignored) { }
                if (activated && old != null && !uri.toString().equals(old))
                    try { getContentResolver().releasePersistableUriPermission(Uri.parse(old), STORAGE_FLAGS); } catch (Exception ignored) { }
            }
        }, "profile-folder").start();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_STORAGE) {
            if (result == RESULT_OK && data != null && data.getData() != null)
                activateStorageFolder(data.getData(), data.getFlags());
            else choosingFolder = false;
        }
        if (request == 101) prompts.fileResult(result, data);
        if (request == 102) {
            File staged = pendingExport; pendingExport = null;
            if (result != RESULT_OK || data == null || data.getData() == null || staged == null) {
                if (staged != null) staged.delete();
                return;
            }
            final Uri uri = data.getData();
            new Thread(()->{
                try (InputStream input = new FileInputStream(staged); OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("无法打开导出文件");
                    byte[] buffer = new byte[16384]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                } catch (Exception error) { alert("导出失败：" + error.getMessage()); }
                finally { staged.delete(); }
            }, "profile-export").start();
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("choosingFolder", choosingFolder);
        if (pendingExport != null) state.putString("pendingExport", pendingExport.getName());
    }
    @Override public void onBackPressed() {
        if (assets == null || !clientStarted) { finish(); return; }
        assets.event("back", true);
    }
    @Override protected void onPause() {
        if (assets != null) assets.event("background", true);
        if (web != null) web.setActive(false);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.setActive(true);
        if (assets != null) assets.event("foreground", true);
    }
    @Override protected void onDestroy() {
        if (prompts != null) prompts.cancelFile();
        if (web != null) web.close();
        if (assets != null) assets.close();
        super.onDestroy();
    }
}
