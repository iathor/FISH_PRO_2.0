package ru.klevpro.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public final class AppDataVault {
    public static final String APPDATA_PREFS_NAME = "klev_pro_appdata_vault_v1";
    public static final String APPDATA_DIR_NAME = "klev_appdata_vault";
    public static final String MIRROR_DIR_NAME = "klev_userdata_mirror";
    public static final int MAX_VAULT_VALUE_CHARS = 15 * 1024 * 1024;
    private static final Object VAULT_LOCK = new Object();

    private final Context appContext;

    public AppDataVault(Context context) {
        Context app = context != null ? context.getApplicationContext() : null;
        this.appContext = app != null ? app : context;
    }

    public File getPrimaryDir() {
        File dir = new File(appContext.getFilesDir(), APPDATA_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    public File getMirrorDir() {
        File dir = appContext.getDir(MIRROR_DIR_NAME, Context.MODE_PRIVATE);
        if (dir != null && !dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private static String sanitizeVaultKeyFileName(String key) {
        if (key == null) return "empty_key";
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
        try (InputStream is = new FileInputStream(file);
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

    public boolean saveKey(String key, String value) {
        if (key == null || key.trim().isEmpty() || value == null) return false;
        String cleanKey = key.trim();
        if (cleanKey.length() > 256 || value.length() > MAX_VAULT_VALUE_CHARS) return false;
        synchronized (VAULT_LOCK) {
            boolean ok = false;
            try {
                byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_VAULT_VALUE_CHARS) return false;
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryDir(), fName);
                writeFileAtomically(primaryFile, bytes);
                ok = true;

                File mirrorDir = getMirrorDir();
                if (mirrorDir != null) {
                    File mirrorFile = new File(mirrorDir, fName);
                    writeFileAtomically(mirrorFile, bytes);
                }

                SharedPreferences prefs = appContext.getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
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

    public String loadKey(String key) {
        if (key == null || key.trim().isEmpty()) return null;
        String cleanKey = key.trim();
        synchronized (VAULT_LOCK) {
            try {
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryDir(), fName);
                String val = readFileUtf8(primaryFile);
                if (val != null && !val.isEmpty()) return val;

                File mirrorDir = getMirrorDir();
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

                SharedPreferences prefs = appContext.getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
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

    public boolean removeKey(String key) {
        if (key == null || key.trim().isEmpty()) return false;
        String cleanKey = key.trim();
        synchronized (VAULT_LOCK) {
            try {
                String fName = sanitizeVaultKeyFileName(cleanKey);
                File primaryFile = new File(getPrimaryDir(), fName);
                if (primaryFile.exists()) primaryFile.delete();
                File mirrorDir = getMirrorDir();
                if (mirrorDir != null) {
                    File mirrorFile = new File(mirrorDir, fName);
                    if (mirrorFile.exists()) mirrorFile.delete();
                }
                SharedPreferences prefs = appContext.getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
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

    public String loadAllJson() {
        synchronized (VAULT_LOCK) {
            JSONObject out = new JSONObject();
            try {
                SharedPreferences prefs = appContext.getSharedPreferences(APPDATA_PREFS_NAME, Context.MODE_PRIVATE);
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
                    "klev_pro_voice_screen_v1",
                    "klev_pro_voice_bg_v1",
                    "klev_pro_clean_slate_v2_1_1_r4",
                    "klev_pro_clean_slate_notice_v2_1_1_r4"
                };
                for (String dk : defaultKeys) {
                    if (!idxObj.has(dk)) {
                        idxObj.put(dk, sanitizeVaultKeyFileName(dk));
                    }
                }
                Iterator<String> keys = idxObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String val = loadKey(k);
                    if (val != null && !val.isEmpty()) {
                        out.put(k, val);
                    }
                }
            } catch (Exception ignored) {}
            return out.toString();
        }
    }

    public String getStatsJson() {
        try {
            File dir = getPrimaryDir();
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
}
