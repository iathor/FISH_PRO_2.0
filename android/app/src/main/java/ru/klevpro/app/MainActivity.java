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
import android.content.SharedPreferences;
import org.json.JSONObject;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import java.util.Locale;
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
import android.webkit.PermissionRequest;
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
    private static final int REQ_CAMERA_CAPTURE = 1003;
    private static final int REQ_CAMERA_PERM = 1004;
    private static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    private static final String CHANNEL_ALERTS = "klev_pro_alerts";
    private static final String CHANNEL_FILES = "klev_pro_files";
    private static final String CHANNEL_NAV = "klev_pro_nav";
    private static final int NAV_ONGOING_NOTIF_ID = 1999;
    private static final String PERM_POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private static final String PERM_READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES";
    private static final AtomicInteger NOTIF_ID_SEQ = new AtomicInteger(2000);

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private volatile int gnssSatellitesUsedCount = 0;
    private volatile int gnssSatellitesVisibleCount = 0;
    private volatile float lastGpsAccuracyMeters = 0f;
    private volatile boolean isAppInForeground = true;
    private volatile boolean isBgRouteTrackingActive = false;
    private volatile boolean bgVoiceGuidanceEnabled = true;
    private TextToSpeech ttsEngine;
    private volatile boolean ttsReady = false;
    private volatile String pendingTtsPhrase = null;
    private PowerManager.WakeLock bgRouteWakeLock;
    private LocationManager nativeLocationManager;
    private LocationListener nativeLocationListener;
    private GnssStatus.Callback gnssStatusCallback;
    private boolean pendingCameraLaunchAfterPerm = false;
    private Uri pendingCameraPhotoUri = null;
    private long lastRootBackPressMs = 0L;
    private OnBackInvokedCallback backInvokedCallback;


    private static final String APPDATA_PREFS_NAME = "klev_pro_appdata_vault_v1";
    private static final String APPDATA_DIR_NAME = "klev_appdata_vault";
    private static final Object VAULT_LOCK = new Object();

    private File getPrimaryAppDataVaultDir() {
        File dir = new File(getFilesDir(), APPDATA_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private File getMirrorAppDataVaultDir() {
        File dir = getDir("klev_userdata_mirror", Context.MODE_PRIVATE);
        if (dir != null && !dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private static String sanitizeVaultKeyFileName(String key) {
        if (key == null) return " empty_key";
        return key.trim().replaceAll("[^a-zA-Z0-9._-]", "_") + ".dat";
    }

    private static void writeFileAtomically(File targetFile, byte[] bytes) throws Exception {
        if (targetFile == null) return;
        File parent = targetFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        File tmpFile = new File(parent, targetFile.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmpFile)) {
            fos.write(bytes);
            fos.getFD().sync();
        }
        if (!tmpFile.renameTo(targetFile)) {
            try (FileOutputStream fos2 = new FileOutputStream(targetFile)) {
                fos2.write(bytes);
                fos2.getFD().sync();
            }
            tmpFile.delete();
        }
    }

    private static String readFileUtf8(File file) {
        if (file == null || !file.exists() || !file.isFile()) return null;
        try (InputStream is = new java.io.FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = is.read(buf)) != -1) {
                bos.write(buf, 0, r);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private boolean saveKeyToNativeAppDataVault(String key, String value) {
        if (key == null || key.trim().isEmpty() || value == null) return false;
        String cleanKey = key.trim();
        synchronized (VAULT_LOCK) {
            boolean ok = false;
            try {
                byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryAppDataVaultDir(), fName);
                writeFileAtomically(primaryFile, bytes);
                ok = true;

                File mirrorDir = getMirrorAppDataVaultDir();
                if (mirrorDir != null) {
                    File mirrorFile = new File(mirrorDir, fName);
                    writeFileAtomically(mirrorFile, bytes);
                }

                // Store index of keys + small/medium values in SharedPreferences (also in App Data, never cleared by Clear Cache)
                SharedPreferences prefs = getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor ed = prefs.edit();
                String rawIndex = prefs.getString("__vault_keys_index__", "{}");
                JSONObject idxObj;
                try {
                    idxObj = new JSONObject(rawIndex);
                } catch (Exception ex) {
                    idxObj = new JSONObject();
                }
                idxObj.put(cleanKey, fName);
                ed.putString("__vault_keys_index__", idxObj.toString());
                if (value.length() <= 262144) {
                    ed.putString("k_" + cleanKey, value);
                }
                ed.apply();
            } catch (Exception ignored) {}
            return ok;
        }
    }

    private String loadKeyFromNativeAppDataVault(String key) {
        if (key == null || key.trim().isEmpty()) return null;
        String cleanKey = key.trim();
        synchronized (VAULT_LOCK) {
            try {
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryAppDataVaultDir(), fName);
                String val = readFileUtf8(primaryFile);
                if (val != null && !val.isEmpty()) return val;

                File mirrorDir = getMirrorAppDataVaultDir();
                if (mirrorDir != null) {
                    File mirrorFile = new File(mirrorDir, fName);
                    val = readFileUtf8(mirrorFile);
                    if (val != null && !val.isEmpty()) {
                        try {
                            writeFileAtomically(primaryFile, val.getBytes(StandardCharsets.UTF_8));
                        } catch (Exception ignored) {}
                        return val;
                    }
                }

                SharedPreferences prefs = getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
                val = prefs.getString("k_" + cleanKey, null);
                if (val != null && !val.isEmpty()) {
                    try {
                        writeFileAtomically(primaryFile, val.getBytes(StandardCharsets.UTF_8));
                    } catch (Exception ignored) {}
                    return val;
                }
            } catch (Exception ignored) {}
            return null;
        }
    }

    private boolean removeKeyFromNativeAppDataVault(String key) {
        if (key == null || key.trim().isEmpty()) return false;
        String cleanKey = key.trim();
        synchronized (VAULT_LOCK) {
            try {
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryAppDataVaultDir(), fName);
                if (primaryFile.exists()) primaryFile.delete();
                File mirrorDir = getMirrorAppDataVaultDir();
                if (mirrorDir != null) {
                    File mirrorFile = new File(mirrorDir, fName);
                    if (mirrorFile.exists()) mirrorFile.delete();
                }
                SharedPreferences prefs = getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor ed = prefs.edit();
                ed.remove("k_" + cleanKey);
                String rawIndex = prefs.getString("__vault_keys_index__", "{}");
                try {
                    JSONObject idxObj = new JSONObject(rawIndex);
                    idxObj.remove(cleanKey);
                    ed.putString("__vault_keys_index__", idxObj.toString());
                } catch (Exception ignored) {}
                ed.apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    private String loadAllNativeAppDataVaultJson() {
        synchronized (VAULT_LOCK) {
            JSONObject out = new JSONObject();
            try {
                SharedPreferences prefs = getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
                String rawIndex = prefs.getString("__vault_keys_index__", "{}");
                JSONObject idxObj;
                try {
                    idxObj = new JSONObject(rawIndex);
                } catch (Exception ex) {
                    idxObj = new JSONObject();
                }
                String[] defaultKeys = new String[]{
                    "klev_pro_state_v2.0",
                    "klev_pro_weather_v2.0",
                    "klev_pro_v200_state",
                    "klev_pro_spots_backup_v2",
                    "klev_pro_catches_backup_v2",
                    "klev_pro_phase3_routes_v1",
                    "klev_pro_phase3_active_track_v1",
                    "klev_pro_circle_packs_v2",
                    "klev_pro_circle_chats_v2",
                    "klev_pro_circle_notifs_v2",
                    "klev_pro_device_id_v2",
                    "klev_pro_photo_dhashes_v2",
                    "klev_pro_geo_weather_archive_v2",
                    "klev_pro_v259_waters_cache_r196",
                    "klev_pro_bg_voice_v1",
                    "klev_pro_voice_nav_v1",
                    "klev_pro_clean_slate_v2_1_1_r4",
                    "klev_pro_clean_slate_notice_v2_1_1_r4"
                };
                for (String dk : defaultKeys) {
                    if (!idxObj.has(dk)) {
                        idxObj.put(dk, sanitizeVaultKeyFileName(dk));
                    }
                }
                java.util.Iterator<String> keys = idxObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String val = loadKeyFromNativeAppDataVault(k);
                    if (val != null && !val.isEmpty()) {
                        out.put(k, val);
                    }
                }
            } catch (Exception ignored) {}
            return out.toString();
        }
    }

    public class NativeBridge {
        private final Context ctx;

        public NativeBridge(Context ctx) {
            this.ctx = ctx;
        }

        @JavascriptInterface
        public boolean hasCameraAndPhotoPermissions() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    boolean camOk = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    boolean mediaOk = true;
                    if (Build.VERSION.SDK_INT >= 33) {
                        mediaOk = checkSelfPermission(PERM_READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
                    } else {
                        mediaOk = checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
                    }
                    return camOk && mediaOk;
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void openNativeCamera() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            pendingCameraLaunchAfterPerm = true;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
                            return;
                        }
                    }
                    launchNativeCameraIntent();
                }
            });
        }

        @JavascriptInterface
        public void requestCameraAndPhotoPermissions() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        List<String> needed = new ArrayList<>();
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            needed.add(Manifest.permission.CAMERA);
                        }
                        if (Build.VERSION.SDK_INT >= 33) {
                            if (checkSelfPermission(PERM_READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                                needed.add(PERM_READ_MEDIA_IMAGES);
                            }
                        } else {
                            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                            }
                        }
                        if (!needed.isEmpty()) {
                            requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean isSystemLocationEnabled() {
            try {
                android.location.LocationManager lm = (android.location.LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
                if (lm == null) return true;
                return lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                    || lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER);
            } catch (Exception e) {
                return true;
            }
        }

        @JavascriptInterface
        public void openLocationSourceSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.os.PowerManager pm = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        return pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
                    }
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                            startActivity(intent);
                        }
                    } catch (Exception e) {
                        try {
                            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            startActivity(fallback);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean hasBackgroundLocationPermission() {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    return checkSelfPermission("android.permission.ACCESS_BACKGROUND_LOCATION") == PackageManager.PERMISSION_GRANTED;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestBackgroundLocationPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT >= 29) {
                            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, "android.permission.ACCESS_BACKGROUND_LOCATION"}, REQ_PERMISSIONS);
                            } else {
                                requestPermissions(new String[]{"android.permission.ACCESS_BACKGROUND_LOCATION"}, REQ_PERMISSIONS);
                            }
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMISSIONS);
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void setKeepScreenAndCpuAwake(final boolean enabled) {
            isBgRouteTrackingActive = enabled;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (enabled) {
                            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            acquireNativeRouteWakeLock();
                            startNativeLocationUpdates();
                            if (webView != null) {
                                webView.resumeTimers();
                            }
                            showOngoingRouteNotification("Клёв ПРО 2.0 • Ведение по маршруту", "Фоновая запись GPS и голосовое сопровождение активны");
                        } else {
                            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            releaseNativeRouteWakeLock();
                            cancelOngoingRouteNotification();
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void setBgVoiceEnabled(final boolean enabled) {
            bgVoiceGuidanceEnabled = enabled;
        }

        @JavascriptInterface
        public boolean isBgVoiceEnabled() {
            return bgVoiceGuidanceEnabled;
        }

        @JavascriptInterface
        public void speakTts(final String text, final boolean flush) {
            if (text == null || text.trim().isEmpty()) return;
            if (!isAppInForeground && !bgVoiceGuidanceEnabled) {
                return;
            }
            final String clean = text.trim();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    speakNativeRussianTts(clean, flush);
                }
            });
        }

        @JavascriptInterface
        public void stopTts() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (ttsEngine != null) {
                            ttsEngine.stop();
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void playNavTone(final String kind) {
            if (!isAppInForeground && !bgVoiceGuidanceEnabled) return;
            try {
                int toneType = ToneGenerator.TONE_PROP_BEEP;
                int durMs = 160;
                if ("warn".equalsIgnoreCase(kind) || "offtrack".equalsIgnoreCase(kind)) {
                    toneType = ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD;
                    durMs = 280;
                } else if ("good".equalsIgnoreCase(kind) || "arrive".equalsIgnoreCase(kind)) {
                    toneType = ToneGenerator.TONE_PROP_ACK;
                    durMs = 240;
                }
                final ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90);
                tg.startTone(toneType, durMs);
                new android.os.Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try { tg.release(); } catch (Exception ignored) {}
                    }
                }, durMs + 100L);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void updateNavNotification(final String title, final String subtitle) {
            if (!isBgRouteTrackingActive) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showOngoingRouteNotification(
                        (title != null && !title.isEmpty()) ? title : "Клёв ПРО 2.0 • Ведение по маршруту",
                        (subtitle != null && !subtitle.isEmpty()) ? subtitle : "Навигация по маршруту активна"
                    );
                }
            });
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
        public int getGnssSatellitesUsed() {
            return gnssSatellitesUsedCount;
        }

        @JavascriptInterface
        public int getGnssSatellitesVisible() {
            return gnssSatellitesVisibleCount;
        }

        @JavascriptInterface
        public float getLastLocationAccuracyMeters() {
            return lastGpsAccuracyMeters;
        }

        @JavascriptInterface
        public boolean saveAppDataKey(String key, String value) {
            return saveKeyToNativeAppDataVault(key, value);
        }

        @JavascriptInterface
        public String loadAppDataKey(String key) {
            String val = loadKeyFromNativeAppDataVault(key);
            return val != null ? val : "";
        }

        @JavascriptInterface
        public boolean removeAppDataKey(String key) {
            return removeKeyFromNativeAppDataVault(key);
        }

        @JavascriptInterface
        public String loadAllAppDataJson() {
            return loadAllNativeAppDataVaultJson();
        }

        @JavascriptInterface
        public String getAppDataVaultStats() {
            try {
                File dir = getPrimaryAppDataVaultDir();
                File[] files = dir.listFiles();
                int count = files != null ? files.length : 0;
                long bytes = 0L;
                if (files != null) {
                    for (File f : files) {
                        if (f.isFile()) bytes += f.length();
                    }
                }
                JSONObject st = new JSONObject();
                st.put("storageLocation", "Android Internal AppData (Context.getFilesDir)");
                st.put("immuneToClearCache", true);
                st.put("filesCount", count);
                st.put("totalBytes", bytes);
                return st.toString();
            } catch (Exception e) {
                return "{\"immuneToClearCache\":true}";
            }
        }

        @JavascriptInterface
        public String getAppVersion() {
            return "2.8.3-r229";
        }

        @JavascriptInterface
        public int getAppBuildNumber() {
            return 229;
        }

        @JavascriptInterface
        public String getAppRevision() {
            return "r229";
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
        public void openExternalUrl(String url) {
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

                builder.setSmallIcon(R.drawable.ic_launcher)
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

                NotificationChannel navChannel = new NotificationChannel(
                    CHANNEL_NAV,
                    "Навигация и ведение по маршруту в фоне",
                    NotificationManager.IMPORTANCE_LOW
                );
                navChannel.setDescription("Постоянный статус активной записи маршрута и голосового ведения в фоновом режиме");
                navChannel.setShowBadge(false);
                navChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(navChannel);
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
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Пользовательские данные защищены в Context.getFilesDir()/klev_appdata_vault; кэш WebView не очищается принудительно
        String baseUa = ws.getUserAgentString();
        ws.setUserAgentString((baseUa != null ? baseUa : "") + " KlevProAPK/2.8.3-r229");

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
                    if ("/__klev_net_proxy__".equals(path)) {
                        String targetUrl = uri.getQueryParameter("url");
                        if (targetUrl != null && (targetUrl.startsWith("https://") || targetUrl.startsWith("http://"))) {
                            HttpURLConnection conn = null;
                            try {
                                URL u = new URL(targetUrl);
                                String h = u.getHost() != null ? u.getHost().toLowerCase() : "";
                                if (h.endsWith("meteoinfo.ru") || h.endsWith("met.no") || h.endsWith("open-meteo.com") || h.endsWith("project-osrm.org") || h.endsWith("openstreetmap.de") || h.endsWith("openstreetmap.org") || h.endsWith("workers.dev") || h.endsWith("klevpro.ru")) {
                                    conn = (HttpURLConnection) u.openConnection();
                                    conn.setRequestMethod("GET");
                                    conn.setConnectTimeout(6500);
                                    conn.setReadTimeout(7500);
                                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; KlevPro/2.8.3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
                                    conn.setRequestProperty("Accept", "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                                    conn.setRequestProperty("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.5");
                                    int code = conn.getResponseCode();
                                    if (code >= 200 && code < 300) {
                                        InputStream netIn = conn.getInputStream();
                                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                        byte[] buf = new byte[8192];
                                        int r;
                                        while ((r = netIn.read(buf)) != -1) {
                                            bos.write(buf, 0, r);
                                        }
                                        netIn.close();
                                        byte[] data = bos.toByteArray();
                                        String cType = conn.getContentType();
                                        if (cType == null || cType.isEmpty()) cType = "application/json";
                                        String mimeOnly = cType.contains(";") ? cType.split(";")[0].trim() : cType.trim();
                                        Map<String, String> corsHeaders = new HashMap<>();
                                        corsHeaders.put("Access-Control-Allow-Origin", "*");
                                        corsHeaders.put("Cache-Control", "no-store");
                                        return new WebResourceResponse(mimeOnly, "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(data));
                                    }
                                }
                            } catch (Exception ignored) {
                            } finally {
                                if (conn != null) {
                                    try { conn.disconnect(); } catch (Exception ignored) {}
                                }
                            }
                        }
                        Map<String, String> errHeaders = new HashMap<>();
                        errHeaders.put("Access-Control-Allow-Origin", "*");
                        return new WebResourceResponse("application/json", "UTF-8", 502, "Net Proxy Error", errHeaders, new ByteArrayInputStream("{\"ok\":false}".getBytes(StandardCharsets.UTF_8)));
                    }
                    if ("/__klev_tile_proxy__".equals(path)) {
                        String targetUrl = uri.getQueryParameter("url");
                        if (targetUrl != null && targetUrl.startsWith("https://")) {
                            HttpURLConnection conn = null;
                            try {
                                URL u = new URL(targetUrl);
                                String h = u.getHost() != null ? u.getHost().toLowerCase() : "";
                                if (h.endsWith("maps.yandex.net") || h.endsWith("arcgisonline.com") || h.endsWith("openstreetmap.org") || h.endsWith("cartocdn.com") || h.endsWith("opentopomap.org")) {
                                    conn = (HttpURLConnection) u.openConnection();
                                    conn.setRequestMethod("GET");
                                    conn.setConnectTimeout(6000);
                                    conn.setReadTimeout(7000);
                                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
                                    conn.setRequestProperty("Referer", "https://yandex.ru/maps/");
                                    conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
                                    int code = conn.getResponseCode();
                                    if (code >= 200 && code < 300) {
                                        InputStream netIn = conn.getInputStream();
                                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                        byte[] buf = new byte[8192];
                                        int r;
                                        while ((r = netIn.read(buf)) != -1) {
                                            bos.write(buf, 0, r);
                                        }
                                        netIn.close();
                                        byte[] data = bos.toByteArray();
                                        String cType = conn.getContentType();
                                        if (cType == null || cType.isEmpty()) cType = "image/png";
                                        if (cType.contains(";")) cType = cType.split(";")[0].trim();
                                        Map<String, String> corsHeaders = new HashMap<>();
                                        corsHeaders.put("Access-Control-Allow-Origin", "*");
                                        corsHeaders.put("Cache-Control", "public, max-age=86400");
                                        return new WebResourceResponse(cType, null, 200, "OK", corsHeaders, new ByteArrayInputStream(data));
                                    }
                                }
                            } catch (Exception ignored) {
                            } finally {
                                if (conn != null) {
                                    try { conn.disconnect(); } catch (Exception ignored) {}
                                }
                            }
                        }
                        Map<String, String> errHeaders = new HashMap<>();
                        errHeaders.put("Access-Control-Allow-Origin", "*");
                        return new WebResourceResponse("text/plain", "UTF-8", 502, "Tile Proxy Error", errHeaders, new ByteArrayInputStream(new byte[0]));
                    }
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
                if (host.equals("t.me") || host.equals("telegram.me") || scheme.equals("tg") || scheme.equals("mailto") || scheme.equals("sms") || scheme.equals("smsto") || scheme.equals("tel") || scheme.equals("geo") || host.contains("yandex.") || host.contains("google.") || host.contains("2gis.") || host.contains("openstreetmap.") || host.contains("leafletjs.") || host.contains("open-meteo.") || host.contains("met.no")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        return true;
                    } catch (Exception ignored) {}
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (request == null) return;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMISSIONS);
                            }
                        }
                        try {
                            request.grant(request.getResources());
                        } catch (Exception ignored) {}
                    }
                });
            }

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
                    if (acceptTypes != null && acceptTypes.length >= 1 && acceptTypes[0] != null && acceptTypes[0].startsWith("image/")) {
                        imageOnly = true;
                        contentIntent.setType("image/*");
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            List<String> mediaPerms = new ArrayList<>();
                            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                mediaPerms.add(Manifest.permission.CAMERA);
                            }
                            if (Build.VERSION.SDK_INT >= 33) {
                                if (checkSelfPermission(PERM_READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                                    mediaPerms.add(PERM_READ_MEDIA_IMAGES);
                                }
                            } else if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                                mediaPerms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                            }
                            if (!mediaPerms.isEmpty()) {
                                requestPermissions(mediaPerms.toArray(new String[0]), REQ_PERMISSIONS);
                            }
                        }
                    }
                    boolean isCapture = (fileChooserParams != null && fileChooserParams.isCaptureEnabled());
                    if (isCapture) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            pendingCameraLaunchAfterPerm = true;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
                            return true;
                        }
                        launchNativeCameraIntent();
                        return true;
                    }
                    Intent chooser = Intent.createChooser(contentIntent, imageOnly ? "Выберите фото улова" : "Выберите файл (.GPX, .KML, .JSON, .CSV, фото)");
                    if (imageOnly) {
                        try {
                            Intent camIntent = createCameraCaptureIntentWithUri();
                            if (camIntent != null) {
                                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camIntent});
                            }
                        } catch (Exception ignored) {}
                    }
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

        initNativeTextToSpeech();
        requestStartupPermissionsIfNeeded();
        startNativeLocationUpdates();
        loadEntryUrlFromIntent(getIntent());
    }

    private void initNativeTextToSpeech() {
        try {
            if (ttsEngine != null) return;
            ttsEngine = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS && ttsEngine != null) {
                        try {
                            Locale ruLoc = new Locale("ru", "RU");
                            int res = ttsEngine.setLanguage(ruLoc);
                            if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                                ttsEngine.setLanguage(new Locale("ru"));
                            }
                            ttsEngine.setSpeechRate(0.98f);
                            ttsEngine.setPitch(1.0f);
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                AudioAttributes ttsAttr = new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build();
                                ttsEngine.setAudioAttributes(ttsAttr);
                            }
                            ttsReady = true;
                            if (pendingTtsPhrase != null && !pendingTtsPhrase.isEmpty()) {
                                String phr = pendingTtsPhrase;
                                pendingTtsPhrase = null;
                                speakNativeRussianTts(phr, true);
                            }
                        } catch (Exception ignored) {}
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    private void speakNativeRussianTts(final String phrase, final boolean flush) {
        if (phrase == null || phrase.isEmpty()) return;
        try {
            if (ttsEngine == null) {
                pendingTtsPhrase = phrase;
                initNativeTextToSpeech();
                return;
            }
            if (!ttsReady) {
                pendingTtsPhrase = phrase;
                return;
            }
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                try {
                    am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                } catch (Exception ignored) {}
            }
            int queueMode = flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Bundle params = new Bundle();
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                ttsEngine.speak(phrase, queueMode, params, "klev_nav_" + System.currentTimeMillis());
            } else {
                HashMap<String, String> params = new HashMap<>();
                params.put(TextToSpeech.Engine.KEY_PARAM_STREAM, String.valueOf(AudioManager.STREAM_MUSIC));
                ttsEngine.speak(phrase, queueMode, params);
            }
        } catch (Exception ignored) {}
    }

    private void acquireNativeRouteWakeLock() {
        try {
            if (bgRouteWakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    bgRouteWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KlevPro::RouteWakeLock");
                    bgRouteWakeLock.setReferenceCounted(false);
                }
            }
            if (bgRouteWakeLock != null && !bgRouteWakeLock.isHeld()) {
                bgRouteWakeLock.acquire(12 * 60 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private void releaseNativeRouteWakeLock() {
        try {
            if (bgRouteWakeLock != null && bgRouteWakeLock.isHeld()) {
                bgRouteWakeLock.release();
            }
        } catch (Exception ignored) {}
    }

    private void showOngoingRouteNotification(String title, String body) {
        try {
            initNotificationChannels();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(PERM_POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            Intent tapIntent = new Intent(this, MainActivity.class);
            tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(this, 101, tapIntent, piFlags);
            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(this, CHANNEL_NAV);
            } else {
                builder = new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
            }
            builder.setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setOngoing(true)
                .setContentIntent(pi);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                builder.setVisibility(Notification.VISIBILITY_PUBLIC);
                builder.setColor(Color.parseColor("#10b981"));
            }
            Notification notif = builder.build();
            notif.flags |= Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR;
            nm.notify(NAV_ONGOING_NOTIF_ID, notif);
        } catch (Exception ignored) {}
    }

    private void cancelOngoingRouteNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NAV_ONGOING_NOTIF_ID);
            }
        } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    private void startNativeLocationUpdates() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
            if (nativeLocationManager == null) {
                nativeLocationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            }
            if (nativeLocationManager == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && gnssStatusCallback == null) {
                gnssStatusCallback = new GnssStatus.Callback() {
                    @Override
                    public void onSatelliteStatusChanged(GnssStatus status) {
                        if (status == null) return;
                        int total = status.getSatelliteCount();
                        int used = 0;
                        for (int i = 0; i < total; i++) {
                            if (status.usedInFix(i)) used++;
                        }
                        gnssSatellitesVisibleCount = total;
                        gnssSatellitesUsedCount = used;
                    }
                };
                try {
                    nativeLocationManager.registerGnssStatusCallback(gnssStatusCallback);
                } catch (Exception ignored) {}
            }

            if (nativeLocationListener == null) {
                nativeLocationListener = new LocationListener() {
                    @Override
                    public void onLocationChanged(final Location loc) {
                        if (loc == null) return;
                        lastGpsAccuracyMeters = loc.getAccuracy();
                        if (webView != null) {
                            final double lat = loc.getLatitude();
                            final double lon = loc.getLongitude();
                            final float acc = loc.getAccuracy();
                            final float spd = loc.hasSpeed() ? loc.getSpeed() : 0f;
                            final float brg = loc.hasBearing() ? loc.getBearing() : 0f;
                            final long ts = loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis();
                            webView.post(new Runnable() {
                                @Override
                                public void run() {
                                    try {
                                        if (isBgRouteTrackingActive && webView != null) {
                                            webView.resumeTimers();
                                        }
                                        webView.evaluateJavascript(
                                            "if(typeof window.__KLEV_ON_NATIVE_GPS_FIX__==='function'){window.__KLEV_ON_NATIVE_GPS_FIX__(" + lat + "," + lon + "," + acc + "," + spd + "," + brg + "," + ts + ");}",
                                            null
                                        );
                                    } catch (Exception ignored) {}
                                }
                            });
                        }
                    }
                    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                    @Override public void onProviderEnabled(String provider) {}
                    @Override public void onProviderDisabled(String provider) {}
                };
                try {
                    if (nativeLocationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        nativeLocationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1.0f, nativeLocationListener, Looper.getMainLooper());
                    }
                } catch (Exception ignored) {}
                try {
                    if (nativeLocationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                        nativeLocationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2500L, 2.0f, nativeLocationListener, Looper.getMainLooper());
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        isAppInForeground = true;
        try {
            if (webView != null) {
                webView.onResume();
                webView.resumeTimers();
            }
            startNativeLocationUpdates();
        } catch (Exception ignored) {}
    }

    @Override
    protected void onPause() {
        isAppInForeground = false;
        try {
            if (webView != null) {
                webView.evaluateJavascript("try{if(window.__klevFlushAllToNativeVault)window.__klevFlushAllToNativeVault();}catch(e){}", null);
            }
        } catch (Exception ignored) {}
        super.onPause();
        try {
            if (isBgRouteTrackingActive && webView != null) {
                webView.resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        releaseNativeRouteWakeLock();
        cancelOngoingRouteNotification();
        try {
            if (nativeLocationManager != null && nativeLocationListener != null) {
                nativeLocationManager.removeUpdates(nativeLocationListener);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && nativeLocationManager != null && gnssStatusCallback != null) {
                nativeLocationManager.unregisterGnssStatusCallback(gnssStatusCallback);
            }
        } catch (Exception ignored) {}
        try {
            if (ttsEngine != null) {
                ttsEngine.stop();
                ttsEngine.shutdown();
                ttsEngine = null;
            }
        } catch (Exception ignored) {}
        if (Build.VERSION.SDK_INT >= 33 && backInvokedCallback != null) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // При подключении/отключении Bluetooth-клавиатуры, наушников, повороте экрана или смене темы
        // НЕ пересоздаём Activity и НЕ перезагружаем WebView!
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getData() != null) {
            loadEntryUrlFromIntent(intent);
        }
    }

    private void loadEntryUrlFromIntent(Intent intent) {
        String entryHtml = getPackageName().contains("admin") ? "kp-control-89.html" : "index.html";
        String baseUrl = "https://" + VIRTUAL_HOST + "/assets/www/" + entryHtml + "?v=2.7.0_r225_" + System.currentTimeMillis();
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
        // Этап 5 (Just-in-Time): при старте запрашиваем только базовую геолокацию и уведомления.
        // Камера (CAMERA) и Галерея (READ_MEDIA_IMAGES) запрашиваются только при вызове Ихтио-Сканера или прикреплении фото в Журнал,
        // а фоновая геолокация (ACCESS_BACKGROUND_LOCATION) — только при запуске записи маршрута Фазы 3.
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
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS);
            }
        }
    }

    private Intent createCameraCaptureIntentWithUri() {
        Intent camIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        pendingCameraPhotoUri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "klev_scan_" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES);
            }
            pendingCameraPhotoUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (pendingCameraPhotoUri != null) {
                camIntent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraPhotoUri);
            }
        } catch (Exception ignored) {
            pendingCameraPhotoUri = null;
        }
        return camIntent;
    }

    private void launchNativeCameraIntent() {
        try {
            Intent camIntent = createCameraCaptureIntentWithUri();
            startActivityForResult(camIntent, REQ_CAMERA_CAPTURE);
        } catch (Exception e) {
            try {
                Intent simpleCam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                pendingCameraPhotoUri = null;
                startActivityForResult(simpleCam, REQ_CAMERA_CAPTURE);
            } catch (Exception ex) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                    fileUploadCallback = null;
                }
                Toast.makeText(this, "Не удалось открыть системную камеру устройства", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private String bitmapToDataUrl(Bitmap bmp) {
        if (bmp == null) return null;
        try {
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            int maxDim = 960;
            if (w > maxDim || h > maxDim) {
                float ratio = Math.min((float) maxDim / w, (float) maxDim / h);
                w = Math.max(64, Math.round(w * ratio));
                h = Math.max(64, Math.round(h * ratio));
                bmp = Bitmap.createScaledBitmap(bmp, w, h, true);
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 84, baos);
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            return "data:image/jpeg;base64," + b64;
        } catch (Exception e) {
            return null;
        }
    }

    private String decodeUriToDataUrl(Uri uri) {
        if (uri == null) return null;
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            Bitmap bmp = BitmapFactory.decodeStream(is);
            return bitmapToDataUrl(bmp);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        startNativeLocationUpdates();
        if (requestCode == REQ_CAMERA_PERM || requestCode == REQ_PERMISSIONS) {
            if (pendingCameraLaunchAfterPerm) {
                pendingCameraLaunchAfterPerm = false;
                boolean camGranted = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    camGranted = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                }
                if (camGranted) {
                    launchNativeCameraIntent();
                } else {
                    if (fileUploadCallback != null) {
                        fileUploadCallback.onReceiveValue(null);
                        fileUploadCallback = null;
                    }
                    Toast.makeText(this, "Разрешите доступ к Камере в настройках приложения", Toast.LENGTH_LONG).show();
                }
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAMERA_CAPTURE) {
            if (resultCode == Activity.RESULT_OK) {
                String dataUrl = null;
                if (pendingCameraPhotoUri != null) {
                    dataUrl = decodeUriToDataUrl(pendingCameraPhotoUri);
                }
                if (dataUrl == null && data != null && data.getData() != null) {
                    dataUrl = decodeUriToDataUrl(data.getData());
                }
                if (dataUrl == null && data != null && data.getExtras() != null) {
                    Object rawBmp = data.getExtras().get("data");
                    if (rawBmp instanceof Bitmap) {
                        dataUrl = bitmapToDataUrl((Bitmap) rawBmp);
                    }
                }
                if (fileUploadCallback != null) {
                    if (pendingCameraPhotoUri != null) {
                        fileUploadCallback.onReceiveValue(new Uri[]{pendingCameraPhotoUri});
                    } else if (data != null && data.getData() != null) {
                        fileUploadCallback.onReceiveValue(new Uri[]{data.getData()});
                    } else {
                        fileUploadCallback.onReceiveValue(null);
                    }
                    fileUploadCallback = null;
                }
                if (dataUrl != null && webView != null) {
                    final String safeDataUrl = dataUrl;
                    webView.post(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript(
                                "if (typeof window.__KLEV_ON_NATIVE_CAMERA_PHOTO__ === 'function') { window.__KLEV_ON_NATIVE_CAMERA_PHOTO__('" + safeDataUrl + "'); }",
                                null
                            );
                        }
                    });
                }
            } else {
                if (pendingCameraPhotoUri != null) {
                    try { getContentResolver().delete(pendingCameraPhotoUri, null, null); } catch (Exception ignored) {}
                    pendingCameraPhotoUri = null;
                }
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                    fileUploadCallback = null;
                }
            }
            return;
        }

        if (requestCode == REQ_FILE_CHOOSER && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK) {
                if (data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    int count = clip.getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = clip.getItemAt(i).getUri();
                    }
                } else if (pendingCameraPhotoUri != null) {
                    results = new Uri[]{pendingCameraPhotoUri};
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
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
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
