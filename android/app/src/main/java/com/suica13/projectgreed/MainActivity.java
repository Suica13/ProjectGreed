package com.suica13.projectgreed;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.*;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;

/** Local-only game shell. No remote page is allowed to use the export bridge. */
public final class MainActivity extends Activity {
    // HTTP virtual origin supports existing ws:// LAN servers without HTTPS mixed-content rules.
    private static final String ORIGIN = "http://appassets.androidplatform.net";
    private static final String ENTRY = ORIGIN + "/client.html";
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private static final int PICK = 10, SAVE = 11;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android document picker imports.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        web.setBackgroundColor(0xff111827);
        web.addJavascriptInterface(new ExportBridge(), "AndroidExport");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isEntry(request.getUrl().toString());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost())) return null;
                if ("http".equals(uri.getScheme()) && "/client.html".equals(uri.getPath())) {
                    try {
                        WebResourceResponse response = new WebResourceResponse("text/html", "UTF-8", getAssets().open("client.html"));
                        java.util.Map<String,String> headers = new java.util.HashMap<>();
                        headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: http: https: data: blob:; frame-src 'none'; object-src 'none'");
                        response.setResponseHeaders(headers);
                        return response;
                    } catch (Exception e) { return missing(); }
                }
                return missing(); // Never fall through to the network for virtual-origin paths.
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!isEntry(url)) return;
                // Intercept existing Blob downloads including programmatic anchor.click().
                view.evaluateJavascript("(() => { if(window.__androidDownload) return; window.__androidDownload=true; const old=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download && (this.href.startsWith('blob:')||this.href.startsWith('data:'))){ const name=this.download; fetch(this.href).then(r=>r.blob()).then(b=>{ if(b.size>16*1024*1024) throw Error('Export too large'); const f=new FileReader(); f.onload=()=>AndroidExport.save(name,String(f.result).split(',')[1]); f.readAsDataURL(b); }).catch(e=>alert('导出失败：'+e.message)); }else old.call(this); }; })()", null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try { startActivityForResult(intent, PICK); }
                catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.loadUrl(ENTRY);
    }
    private static boolean isEntry(String url) { return url != null && (url.equals(ENTRY) || url.startsWith(ENTRY + "#")); }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
    }
    public final class ExportBridge {
        @JavascriptInterface public void save(String name, String data) {
            if (data == null || data.length() > 24 * 1024 * 1024) return;
            final byte[] bytes;
            try { bytes = Base64.decode(data, Base64.DEFAULT); } catch (Exception e) { return; }
            runOnUiThread(() -> {
                if (!isEntry(web.getUrl()) || pendingExport != null) return;
                pendingExport = bytes;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/octet-stream");
                intent.putExtra(Intent.EXTRA_TITLE, name == null ? "ProjectGreed-save.json" : name.replaceAll("[/\\\\]", "_").substring(0, Math.min(name.length(), 128)));
                try { startActivityForResult(intent, SAVE); }
                catch (Exception e) { pendingExport = null; Toast.makeText(MainActivity.this,"无法打开保存窗口",Toast.LENGTH_LONG).show(); }
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
        if (request == SAVE) {
            byte[] bytes = pendingExport; pendingExport = null;
            if (result == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new java.io.IOException("No output stream");
                    out.write(bytes);
                    Toast.makeText(this,"已导出",Toast.LENGTH_SHORT).show();
                } catch (Exception e) { Toast.makeText(this,"导出失败",Toast.LENGTH_LONG).show(); }
            }
        }
    }
    @Override public void onBackPressed() {
        new AlertDialog.Builder(this).setMessage("退出 ProjectGreed？进行中的联机可能中断。")
            .setPositiveButton("退出", (dialog, which) -> finish()).setNegativeButton("继续",null).show();
    }
    @Override protected void onPause() { super.onPause(); web.onPause(); web.evaluateJavascript("if(typeof GameAudio!=='undefined' && GameAudio.stopAll) GameAudio.stopAll()",null); }
    @Override protected void onResume() { super.onResume(); if(web != null) web.onResume(); }
    @Override protected void onDestroy() { if(fileCallback != null) fileCallback.onReceiveValue(null); web.removeJavascriptInterface("AndroidExport"); web.destroy(); super.onDestroy(); }
}
