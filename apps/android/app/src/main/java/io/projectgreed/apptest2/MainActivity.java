package io.projectgreed.apptest2;

import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import org.json.JSONObject;
import android.net.Uri;
import android.os.*;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import java.io.*;
import java.util.Locale;

/** Only bundled, trusted game content can navigate in this WebView. */
public final class MainActivity extends Activity {
    private static final String HOST = "projectgreed.localhost";
    private WebView web;
    private ValueCallback<Uri[]> fileChoice;
    private File pendingExport;
    private NativeStore store;
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
        String folder = preferences.getString("saveTree", null);
        store = folder == null ? new NativeStore(new File(getFilesDir(), "profile"))
            : new NativeStore(new SnapshotFiles.Documents(getContentResolver(), Uri.parse(folder)), true, null);
        if (saved != null) {
            choosingFolder = saved.getBoolean("choosingFolder", false);
            String pendingName = saved.getString("pendingExport");
            if (pendingName != null && pendingName.startsWith("pg-export-") && new File(pendingName).getName().equals(pendingName)) {
                File staged = new File(getCacheDir(), pendingName);
                if (staged.isFile()) pendingExport = staged;
            }
        }

        android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
        if (provider != null) {
            try {
                if (Integer.parseInt(provider.versionName.split("[.]")[0]) < 120) {
                    new AlertDialog.Builder(this).setMessage("系统 WebView 版本过旧，请更新 Android System WebView 或 Chrome 至120或更新版本。").setPositiveButton("关闭", (d,w)->finish()).setCancelable(false).show();
                    return;
                }
            } catch (NumberFormatException ignored) { }
        }
        web = new WebView(this);
        android.widget.FrameLayout safeArea = new android.widget.FrameLayout(this);
        safeArea.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        safeArea.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else v.setPadding(0, 0, 0, 0);
            return insets;
        });
        setContentView(safeArea);
        WebSettings settings = web.getSettings();
        // The existing 1600x900 landscape meta viewport must be honored, not cropped
        // into a device-width WebView with its centre as the only visible area.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        // Local virtual HTTP origin preserves existing HTTP/WS servers without mixed-content changes.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(), "ProjectGreedAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isApp(request.getUrl())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                try {
                    String path = uri.getPath();
                    if (path == null || path.contains("..") || path.contains("\\") || !"http".equals(uri.getScheme())) throw new IOException("Invalid asset path");
                    if (path.equals("/")) path = "/client.html";
                    InputStream input = getAssets().open(path.substring(1));
                    String type = mime(path);
                    return new WebResourceResponse(type, type.startsWith("text/") || type.contains("javascript") || type.contains("json") ? "UTF-8" : null, input);
                } catch (IOException error) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                new AlertDialog.Builder(MainActivity.this).setMessage("网页渲染进程已停止，请重新打开客户端。已保存的数据会保留。")
                    .setPositiveButton("关闭", (d,w)->finish()).setCancelable(false).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChoice != null) fileChoice.onReceiveValue(null);
                fileChoice = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] accept = params.getAcceptTypes();
                if (accept != null && accept.length == 1 && accept[0].startsWith("image/")) intent.setType(accept[0]);
                try { startActivityForResult(intent, 101); }
                catch (ActivityNotFoundException error) { fileChoice.onReceiveValue(null); fileChoice = null; alert("未找到系统文件选择器"); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定", (d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();
                return true;
            }
        });
        web.loadUrl("http://" + HOST + "/client.html");
    }
    private static boolean isApp(Uri uri) { return "http".equals(uri.getScheme()) && HOST.equals(uri.getHost()); }
    private static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (ext.equals("js")) return "application/javascript";
        if (ext.equals("json")) return "application/json";
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return type == null ? "application/octet-stream" : type;
    }
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
        @JavascriptInterface public String read() {
            synchronized (storageLock) {
                try { return new JSONObject(store.read()).put("epoch", storeEpoch).toString(); }
                catch (Exception error) { return "{\"ok\":false,\"error\":\"无法读取应用存档\"}"; }
            }
        }
        @JavascriptInterface public String commit(String value) {
            synchronized (storageLock) {
                try {
                    if (!storeEpoch.equals(new JSONObject(value).optString("epoch")))
                        return "{\"ok\":false,\"error\":\"存档位置已切换，请等待界面重新加载\"}";
                    return store.commit(value);
                } catch (Exception error) { return "{\"ok\":false,\"error\":\"存档请求无效\"}"; }
            }
        }
        @JavascriptInterface public void sceneChanged(String scene, boolean ready) {
            runOnUiThread(()->{
                currentScene = scene;
                int orientation = "game".equals(scene) ? ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                if (getRequestedOrientation() != orientation) setRequestedOrientation(orientation);
                if (ready && "menu".equals(scene)) showStoragePrompt();
            });
        }
        @JavascriptInterface public void chooseStorageFolder() { runOnUiThread(()->MainActivity.this.chooseStorageFolder()); }
        @JavascriptInterface public void exit() { runOnUiThread(()->finish()); }
        @JavascriptInterface public void exportFile(String name, String mime, String base64) {
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
        web.evaluateJavascript("document.documentElement.inert=true", null);
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
                    web.evaluateJavascript("document.documentElement.inert=false", null);
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
        if (request == 101 && fileChoice != null) {
            fileChoice.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileChoice = null;
        }
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
        if (web == null) { finish(); return; }
        web.evaluateJavascript("if(window.AppRuntime) AppRuntime.requestBack()", null);
    }
    @Override protected void onPause() {
        super.onPause();
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('app-background'));", null);
            web.onPause();
        }
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.dispatchEvent(new Event('app-foreground'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));", null);
        }
    }
    @Override protected void onDestroy() {
        if (fileChoice != null) fileChoice.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("ProjectGreedAndroid"); web.destroy(); }
        super.onDestroy();
    }
}
