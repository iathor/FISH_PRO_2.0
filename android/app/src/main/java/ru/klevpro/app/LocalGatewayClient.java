package ru.klevpro.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class LocalGatewayClient {
    private LocalGatewayClient() {}

    public static WebResourceResponse interceptVirtualHostRequest(Context context, Uri uri) {
        if (uri == null || !WebViewSecurityClient.VIRTUAL_HOST.equalsIgnoreCase(uri.getHost())) {
            return null;
        }
        String path = uri.getPath();
        if ("/__klev_net_proxy__".equals(path)) {
            return handleNetProxy(uri);
        }
        if ("/__klev_tile_proxy__".equals(path)) {
            return handleTileProxy(uri);
        }
        return handleLocalAsset(context, path);
    }

    public static WebResourceResponse handleNetProxy(Uri uri) {
        String targetUrl = uri != null ? uri.getQueryParameter("url") : null;
        if (targetUrl != null && targetUrl.startsWith("https://")) {
            HttpURLConnection conn = null;
            try {
                String currentUrl = targetUrl;
                for (int redirectStep = 0; redirectStep <= 2; redirectStep++) {
                    URL u = new URL(currentUrl);
                    String h = u.getHost() != null ? u.getHost().toLowerCase(Locale.ROOT) : "";
                    if (!"https".equalsIgnoreCase(u.getProtocol()) || !WebViewSecurityClient.isAllowedNetProxyHost(h)) {
                        break;
                    }
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(6500);
                    conn.setReadTimeout(7500);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; KlevPro/2.9.2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
                    conn.setRequestProperty("Accept", "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                    conn.setRequestProperty("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.5");
                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == HttpURLConnection.HTTP_SEE_OTHER || code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        try { conn.disconnect(); } catch (Exception ignored) {}
                        conn = null;
                        if (loc == null || loc.trim().isEmpty() || redirectStep == 2) break;
                        URL nextUrl = new URL(u, loc.trim());
                        String nextHost = nextUrl.getHost() != null ? nextUrl.getHost().toLowerCase(Locale.ROOT) : "";
                        if (!"https".equalsIgnoreCase(nextUrl.getProtocol()) || !WebViewSecurityClient.isAllowedNetProxyHost(nextHost)) {
                            break;
                        }
                        currentUrl = nextUrl.toString();
                        continue;
                    }
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
                        corsHeaders.put("Access-Control-Allow-Origin", WebViewSecurityClient.VIRTUAL_ORIGIN);
                        corsHeaders.put("Cache-Control", "no-store");
                        return new WebResourceResponse(mimeOnly, "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(data));
                    }
                    break;
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }
        Map<String, String> errHeaders = new HashMap<>();
        errHeaders.put("Access-Control-Allow-Origin", WebViewSecurityClient.VIRTUAL_ORIGIN);
        return new WebResourceResponse("application/json", "UTF-8", 502, "Net Gateway Error", errHeaders, new ByteArrayInputStream("{\"ok\":false}".getBytes(StandardCharsets.UTF_8)));
    }

    public static WebResourceResponse handleTileProxy(Uri uri) {
        String targetUrl = uri != null ? uri.getQueryParameter("url") : null;
        if ((targetUrl == null || targetUrl.isEmpty()) && uri != null) {
            String layer = uri.getQueryParameter("layer");
            String zParam = uri.getQueryParameter("z");
            String xParam = uri.getQueryParameter("x");
            String yParam = uri.getQueryParameter("y");
            if (layer != null && zParam != null && xParam != null && yParam != null
                && zParam.matches("\\d{1,2}") && xParam.matches("\\d{1,7}") && yParam.matches("\\d{1,7}")) {
                if ("yandex_sat".equals(layer)) {
                    targetUrl = "https://sat01.maps.yandex.net/tiles?l=sat&x=" + xParam + "&y=" + yParam + "&z=" + zParam + "&lang=ru_RU";
                } else if ("yandex_skl".equals(layer)) {
                    targetUrl = "https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&v=24.10.30-0&x=" + xParam + "&y=" + yParam + "&z=" + zParam + "&scale=2&lang=ru_RU";
                } else {
                    targetUrl = "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=24.10.30-0&x=" + xParam + "&y=" + yParam + "&z=" + zParam + "&scale=2&lang=ru_RU";
                }
            }
        }
        if (targetUrl != null && targetUrl.startsWith("https://")) {
            HttpURLConnection conn = null;
            try {
                String currentUrl = targetUrl;
                for (int redirectStep = 0; redirectStep <= 2; redirectStep++) {
                    URL u = new URL(currentUrl);
                    String h = u.getHost() != null ? u.getHost().toLowerCase(Locale.ROOT) : "";
                    if (!"https".equalsIgnoreCase(u.getProtocol()) || !WebViewSecurityClient.isAllowedTileProxyHost(h)) {
                        break;
                    }
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(7000);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
                    conn.setRequestProperty("Referer", "https://yandex.ru/maps/");
                    conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == HttpURLConnection.HTTP_SEE_OTHER || code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        try { conn.disconnect(); } catch (Exception ignored) {}
                        conn = null;
                        if (loc == null || loc.trim().isEmpty() || redirectStep == 2) break;
                        URL nextUrl = new URL(u, loc.trim());
                        String nextHost = nextUrl.getHost() != null ? nextUrl.getHost().toLowerCase(Locale.ROOT) : "";
                        if (!"https".equalsIgnoreCase(nextUrl.getProtocol()) || !WebViewSecurityClient.isAllowedTileProxyHost(nextHost)) {
                            break;
                        }
                        currentUrl = nextUrl.toString();
                        continue;
                    }
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
                        corsHeaders.put("Access-Control-Allow-Origin", WebViewSecurityClient.VIRTUAL_ORIGIN);
                        corsHeaders.put("Cache-Control", "public, max-age=86400");
                        return new WebResourceResponse(cType, null, 200, "OK", corsHeaders, new ByteArrayInputStream(data));
                    }
                    break;
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }
        Map<String, String> errHeaders = new HashMap<>();
        errHeaders.put("Access-Control-Allow-Origin", WebViewSecurityClient.VIRTUAL_ORIGIN);
        return new WebResourceResponse("text/plain", "UTF-8", 502, "Tile Gateway Error", errHeaders, new ByteArrayInputStream(new byte[0]));
    }

    public static WebResourceResponse handleLocalAsset(Context context, String path) {
        if (context == null) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
        }
        if (path == null || path.isEmpty() || path.equals("/")) {
            path = "/assets/www/index.html";
        }
        String assetPath = path.startsWith("/assets/") ? path.substring("/assets/".length()) : path.replaceFirst("^/+", "");
        if (assetPath.contains("..")) {
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, null);
        }
        try {
            InputStream is;
            try {
                is = context.getAssets().open(assetPath);
            } catch (Exception firstEx) {
                if (!assetPath.startsWith("www/")) {
                    assetPath = "www/" + assetPath;
                    is = context.getAssets().open(assetPath);
                } else {
                    throw firstEx;
                }
            }
            String mime = guessMimeType(assetPath);
            String encoding = (!mime.startsWith("text/") && !mime.contains("json") && !mime.contains("javascript") && !mime.contains("xml") && !mime.contains("svg")) ? null : "UTF-8";
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", WebViewSecurityClient.VIRTUAL_ORIGIN);
            headers.put("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, is);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
        }
    }

    public static String guessMimeType(String path) {
        if (path == null) return "application/octet-stream";
        String p = path.toLowerCase(Locale.ROOT);
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
}
