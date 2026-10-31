package ru.klevpro.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;
    private static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    private static final String CHANNEL_ALERTS = "klev_pro_alerts";
    private static final String CHANNEL_FILES = "klev_pro_files";
    private static final String PERM_POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private static final AtomicInteger NOTIF_ID_SEQ = new AtomicInteger(2000);

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private long lastRootBackPressMs = 0L;
    private OnBackInvokedCallback backInvokedCallback;

    public class NativeBridge {
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
            return "2.5.2-r189";
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

        @JavascriptInterface
        public boolean areNotificationsEnabled() {
            try {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return false;
                if (Build.VERSION.SDK_INT >= 33) {
                    if (checkSelfPermission(PERM_POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        return false;
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    return nm.areNotificationsEnabled();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    initNotificationChannels();
                    if (Build.VERSION.SDK_INT >= 33) {
                        if (checkSelfPermission(PERM_POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{PERM_POST_NOTIFICATIONS}, REQ_PERMISSIONS);
                            return;
                        }
                    }
                    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) {
                        openNotificationSettings();
                    } else {
                        showSystemNotification("Клёв ПРО 2.0 • Уведомления активны", "Системные уведомления Круга, Экипажа, Чатов и SOS успешно подключены!", "test");
                    }
                }
            });
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            try {
                Intent intent = new Intent();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                } else {
                    intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", ctx.getPackageName(), null));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void showSystemNotification(String title, String body, String category) {
            try {
                initNotificationChannels();
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(PERM_POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }

                String chanId = "files".equalsIgnoreCase(category) ? CHANNEL_FILES : CHANNEL_ALERTS;
                Intent tapIntent = new Intent(ctx, MainActivity.class);
                tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    piFlags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getActivity(ctx, 0, tapIntent, piFlags);

                Notification.Builder builder;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    builder = new Notification.Builder(ctx, chanId);
                } else {
                    builder = new Notification.Builder(ctx)
                        .setPriority(Notification.PRIORITY_HIGH)
                        .setDefaults(Notification.DEFAULT_ALL);
                }

                builder.setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title != null && !title.isEmpty() ? title : "Клёв ПРО 2.0")
                    .setContentText(body != null ? body : "")
                    .setStyle(new Notification.BigTextStyle().bigText(body != null ? body : ""))
                    .setAutoCancel(true)
                    .setContentIntent(pi);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    builder.setVisibility(Notification.VISIBILITY_PUBLIC);
                    builder.setColor(Color.parseColor("#0284c7"));
                }

                nm.notify(NOTIF_ID_SEQ.incrementAndGet(), builder.build());
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public boolean saveFileToDownloads(final String filename, final String content, final String mimeType, final boolean isBase64) {
            if (filename == null || filename.trim().isEmpty() || content == null) return false;
            final String cleanName = filename.trim().replaceAll("[\\\\/:*?\"<>|]", "_");
            final String effMime = (mimeType != null && !mimeType.trim().isEmpty()) ? mimeType.trim() : guessMimeType(cleanName);
            try {
                byte[] bytes;
                if (isBase64) {
                    String pureB64 = content;
                    int commaIdx = pureB64.indexOf(',');
                    if (commaIdx != -1) {
                        pureB64 = pureB64.substring(commaIdx + 1);
                    }
                    bytes = Base64.decode(pureB64, Base64.DEFAULT);
                } else {
                    bytes = content.getBytes(StandardCharsets.UTF_8);
                }

                boolean saved = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = ctx.getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, cleanName);
                    values.put(MediaStore.Downloads.MIME_TYPE, effMime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream os = resolver.openOutputStream(uri)) {
                            if (os != null) {
                                os.write(bytes);
                                os.flush();
                                saved = true;
                            }
                        }
                    }
                }

                if (!saved) {
                    File dlDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (dlDir != null && (dlDir.exists() || dlDir.mkdirs())) {
                        File outFile = new File(dlDir, cleanName);
                        try (FileOutputStream fos = new FileOutputStream(outFile)) {
                            fos.write(bytes);
                            fos.flush();
                            saved = true;
                        }
                    }
                }

                if (saved) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(ctx, "✅ Файл сохранён в Загрузки (Downloads): " + cleanName, Toast.LENGTH_LONG).show();
                        }
                    });
                    showSystemNotification("📥 Файл сохранён в «Загрузки»", cleanName + " (доступен в папке Downloads устройства)", "files");
                    return true;
                }
            } catch (Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(ctx, "Ошибка сохранения файла: " + cleanName, Toast.LENGTH_SHORT).show();
                    }
                });
            }
            return false;
        }
    }

    private void initNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                AudioAttributes audioAttr = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

                NotificationChannel alertsChannel = new NotificationChannel(
                    CHANNEL_ALERTS,
                    "Сигналы Круга, Экипажа, Чаты и SOS",
                    NotificationManager.IMPORTANCE_HIGH
                );
                alertsChannel.setDescription("Мгновенные уведомления о точках в Круге, сообщениях в чатах Экипажа и экстренных сигналах SOS на воде");
                alertsChannel.enableLights(true);
                alertsChannel.setLightColor(Color.parseColor("#38bdf8"));
                alertsChannel.enableVibration(true);
                alertsChannel.setVibrationPattern(new long[]{0, 250, 150, 250});
                alertsChannel.setShowBadge(true);
                alertsChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                if (soundUri != null) {
                    alertsChannel.setSound(soundUri, audioAttr);
                }
                nm.createNotificationChannel(alertsChannel);

                NotificationChannel filesChannel = new NotificationChannel(
                    CHANNEL_FILES,
                    "Выгрузка и сохранение файлов (.GPX, .JSON, .CSV)",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                filesChannel.setDescription("Уведомления о сохранении выгруженных путевых точек, журналов уловов и резервных копий в папку Загрузки");
                filesChannel.setShowBadge(false);
                nm.createNotificationChannel(filesChannel);
            } catch (Exception ignored) {}
        }
    }

    private static String guessMimeType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".gpx")) return "application/gpx+xml";
        if (p.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
        if (p.endsWith(".csv")) return "text/csv";
        if (p.endsWith(".ics")) return "text/calendar";
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

        initNotificationChannels();

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
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        String baseUa = ws.getUserAgentString();
        ws.setUserAgentString((baseUa != null ? baseUa : "") + " KlevProAPK/2.5.2-r189");

        webView.addJavascriptInterface(new NativeBridge(this), "AndroidBridge");

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (url == null) return;
                try {
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    }
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
                if (path.endsWith(".apk") || path.startsWith("/apk/")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                        return true;
                    } catch (Exception ignored) {}
                }
                if (host.equals("klevpro.ru") || host.equals("www.klevpro.ru") || host.equals("xn--b1apdneg0j.xn--p1ai")) {
                    String q = uri.getEncodedQuery();
                    String frag = uri.getEncodedFragment();
                    StringBuilder sb = new StringBuilder("https://" + VIRTUAL_HOST + "/assets/www/index.html");
                    if (q != null && !q.isEmpty()) sb.append("?").append(q);
                    if (frag != null && !frag.isEmpty()) sb.append("#").append(frag);
                    view.loadUrl(sb.toString());
                    return true;
                }
                if (host.equals("t.me") || host.equals("telegram.me") || scheme.equals("tg") || scheme.equals("mailto")) {
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
                        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMISSIONS);
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
                    Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    contentIntent.setType("*/*");
                    String[] acceptTypes = (fileChooserParams != null) ? fileChooserParams.getAcceptTypes() : null;
                    boolean imageOnly = false;
                    if (acceptTypes != null && acceptTypes.length == 1 && acceptTypes[0] != null && acceptTypes[0].startsWith("image/")) {
                        imageOnly = true;
                        contentIntent.setType("image/*");
                    }
                    Intent chooser = Intent.createChooser(contentIntent, imageOnly ? "Выберите фото улова" : "Выберите файл (.GPX, .KML, .JSON, .CSV, фото)");
                    startActivityForResult(chooser, REQ_FILE_CHOOSER);
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

        requestStartupPermissionsIfNeeded();
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
        String baseUrl = "https://" + VIRTUAL_HOST + "/assets/www/index.html?v=2.5.2_r189";
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

    private void requestStartupPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> needed = new ArrayList<>();
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
                needed.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            }
            if (Build.VERSION.SDK_INT >= 33) {
                if (checkSelfPermission(PERM_POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(PERM_POST_NOTIFICATIONS);
                }
            } else if (Build.VERSION.SDK_INT <= 29) {
                if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                    needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    int count = clip.getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = clip.getItemAt(i).getUri();
                    }
                }
            }
            if (results == null) {
                results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
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
