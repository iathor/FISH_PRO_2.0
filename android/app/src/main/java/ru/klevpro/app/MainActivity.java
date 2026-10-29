package ru.klevpro.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Window;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;
    private static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private long lastRootBackPressMs = 0L;
    private OnBackInvokedCallback backInvokedCallback;

    public static class NativeBridge {
        private final Context ctx;

        public NativeBridge(Context ctx) {
            this.ctx = ctx;
        }

        @JavascriptInterface
        public String getDeviceId() {
            try {
                String id = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
                return id != null ? id : "";
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String getAppVersion() {
            return "2.3.0";
        }

        @JavascriptInterface
        public void downloadApkUpdate(String url) {
            if (url == null || url.trim().isEmpty()) return;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    private static String guessMimeType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".apk")) return "application/vnd.android.package-archive";
        return "application/octet-stream";
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.parseColor("#0b1120"));
            window.setNavigationBarColor(Color.parseColor("#151f32"));
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b1120"));
        setContentView(webView);

        WebView.setWebContentsDebuggingEnabled(false);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        String baseUa = ws.getUserAgentString();
        ws.setUserAgentString((baseUa != null ? baseUa : "") + " KlevProAPK/2.3.0");

        webView.addJavascriptInterface(new NativeBridge(this), "AndroidBridge");

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && VIRTUAL_HOST.equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.isEmpty() || path.equals("/")) {
                        path = "/assets/www/index.html";
                    }
                    String assetPath = path.startsWith("/assets/") ? path.substring("/assets/".length()) : path.replaceFirst("^/+", "");
                    try {
                        InputStream is = getAssets().open(assetPath);
                        String mime = guessMimeType(assetPath);
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        headers.put("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
                        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
                    } catch (Exception e) {
                        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                String path = uri.getPath() != null ? uri.getPath().toLowerCase() : "";
                if (host.equals(VIRTUAL_HOST)) {
                    return false;
                }
                // Если запрашивается скачивание .apk обновления — передаём ссылку системному загрузчику Android
                if (path.endsWith(".apk") || path.startsWith("/apk/")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                        return true;
                    } catch (Exception ignored) {}
                }
                if (host.equals("klevpro.ru") || host.equals("www.klevpro.ru")) {
                    String q = uri.getEncodedQuery();
                    String frag = uri.getEncodedFragment();
                    StringBuilder sb = new StringBuilder("https://" + VIRTUAL_HOST + "/assets/www/index.html");
                    if (q != null && !q.isEmpty()) sb.append("?").append(q);
                    if (frag != null && !frag.isEmpty()) sb.append("#").append(frag);
                    view.loadUrl(sb.toString());
                    return true;
                }
                if (host.equals("t.me") || host.equals("telegram.me") || scheme.equals("tg")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                        return true;
                    } catch (Exception ignored) {}
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(final String origin, final GeolocationPermissions.Callback callback) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                    }
                }
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            backInvokedCallback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    handleAppBackGesture();
                }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                backInvokedCallback
            );
        }

        requestLocationPermissionIfNeeded();
        loadEntryUrlFromIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backInvokedCallback != null) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadEntryUrlFromIntent(intent);
    }

    private void loadEntryUrlFromIntent(Intent intent) {
        String baseUrl = "https://" + VIRTUAL_HOST + "/assets/www/index.html?v=2.3.0_r182";
        if (intent != null && intent.getData() != null) {
            Uri data = intent.getData();
            String q = data.getEncodedQuery();
            String frag = data.getEncodedFragment();
            StringBuilder sb = new StringBuilder(baseUrl);
            if (q != null && !q.isEmpty()) {
                sb.append("&").append(q);
            }
            if (frag != null && !frag.isEmpty()) {
                sb.append("#").append(frag);
            }
            webView.loadUrl(sb.toString());
        } else {
            webView.loadUrl(baseUrl);
        }
    }

    private void requestLocationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileUploadCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    private void handleAppBackGesture() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
            "(function(){ try { if (typeof window.__KLEV_HANDLE_BACK__ === 'function') { return window.__KLEV_HANDLE_BACK__('android') ? 'HANDLED' : 'ROOT'; } } catch(e){} return 'ROOT'; })()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (value != null && value.contains("HANDLED")) {
                        return;
                    }
                    long now = System.currentTimeMillis();
                    if (now - lastRootBackPressMs < 2200L) {
                        finish();
                    } else {
                        lastRootBackPressMs = now;
                        Toast.makeText(MainActivity.this, "Смахните «Назад» ещё раз для выхода из приложения", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        );
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleAppBackGesture();
    }
}
