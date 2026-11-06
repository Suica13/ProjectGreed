package io.projectgreed.apptest2;

import android.app.*;
import android.content.*;
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
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(0xff152430);
        getWindow().setNavigationBarColor(0xff152430);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        store = new NativeStore(new File(getFilesDir(), "profile"));
        if (saved != null) {
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
    private void alert(String text) { runOnUiThread(()->new AlertDialog.Builder(this).setMessage(text).setPositiveButton("确定",null).show()); }
    public final class Bridge {
        @JavascriptInterface public String read() { return store.read(); }
        @JavascriptInterface public String commit(String value) { return store.commit(value); }
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
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
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
