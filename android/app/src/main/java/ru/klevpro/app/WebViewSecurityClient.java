package ru.klevpro.app;

import android.net.Uri;
import java.util.Locale;

public final class WebViewSecurityClient {
    public static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    public static final String VIRTUAL_ORIGIN = "https://" + VIRTUAL_HOST;

    private WebViewSecurityClient() {}

    public static boolean isDomainOrSubdomain(String host, String domain) {
        if (host == null || domain == null) return false;
        String h = host.trim().toLowerCase(Locale.ROOT);
        String d = domain.trim().toLowerCase(Locale.ROOT);
        return h.equals(d) || h.endsWith("." + d);
    }

    public static boolean isAllowedNetProxyHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String[] allowed = new String[]{
            "meteoinfo.ru",
            "met.no",
            "open-meteo.com",
            "project-osrm.org",
            "openstreetmap.de",
            "openstreetmap.org",
            "maps.mail.ru",
            "overpass-api.de",
            "overpass.kumi.systems",
            "overpass.private.coffee",
            "workers.dev",
            "klevpro.ru"
        };
        for (String d : allowed) {
            if (isDomainOrSubdomain(host, d)) return true;
        }
        return false;
    }

    public static boolean isAllowedTileProxyHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String[] allowed = new String[]{
            "maps.yandex.net",
            "yandex.net",
            "arcgisonline.com",
            "openstreetmap.org",
            "openstreetmap.fr",
            "cartocdn.com",
            "opentopomap.org",
            "maps.mail.ru",
            "mt0.google.com",
            "mt1.google.com",
            "mt2.google.com",
            "mt3.google.com",
            "khms0.google.com",
            "khms1.google.com"
        };
        for (String d : allowed) {
            if (isDomainOrSubdomain(host, d)) return true;
        }
        return false;
    }

    public static boolean isTrustedExternalHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String[] allowed = new String[]{
            "yandex.ru",
            "yandex.net",
            "yandex.com",
            "google.com",
            "google.ru",
            "2gis.ru",
            "2gis.com",
            "openstreetmap.org",
            "openstreetmap.de",
            "leafletjs.com",
            "open-meteo.com",
            "met.no",
            "meteoinfo.ru",
            "klevpro.ru",
            "xn--b1apdneg0j.xn--p1ai",
            "github.com",
            "githubusercontent.com",
            "workers.dev"
        };
        for (String d : allowed) {
            if (isDomainOrSubdomain(host, d)) return true;
        }
        return false;
    }

    public static boolean isTrustedWebOrigin(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() != null ? uri.getScheme().trim().toLowerCase(Locale.ROOT) : "";
        String host = uri.getHost() != null ? uri.getHost().trim().toLowerCase(Locale.ROOT) : "";
        if (!"https".equals(scheme)) return false;
        return VIRTUAL_HOST.equals(host)
            || isDomainOrSubdomain(host, "klevpro.ru")
            || "xn--b1apdneg0j.xn--p1ai".equals(host);
    }

    public static boolean isTrustedWebOriginStr(String origin) {
        if (origin == null || origin.trim().isEmpty()) return false;
        try {
            return isTrustedWebOrigin(Uri.parse(origin.trim()));
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean isTrustedApkUpdateUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() != null ? uri.getScheme().trim().toLowerCase(Locale.ROOT) : "";
        if (!"https".equals(scheme)) return false;
        String host = uri.getHost() != null ? uri.getHost().trim().toLowerCase(Locale.ROOT) : "";
        String path = uri.getPath() != null ? uri.getPath().trim().toLowerCase(Locale.ROOT) : "";
        if ("github.com".equals(host) || "www.github.com".equals(host) || "raw.githubusercontent.com".equals(host)) {
            return path.startsWith("/iathor/");
        }
        if ("objects.githubusercontent.com".equals(host) || "release-assets.githubusercontent.com".equals(host)) {
            return true;
        }
        return isDomainOrSubdomain(host, "klevpro.ru")
            || "xn--b1apdneg0j.xn--p1ai".equals(host)
            || isDomainOrSubdomain(host, "workers.dev")
            || isDomainOrSubdomain(host, "githubusercontent.com");
    }

    public static boolean isTelegramUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        String s = scheme.trim().toLowerCase(Locale.ROOT);
        if ("tg".equals(s)) return true;
        if (!"https".equals(s) && !"http".equals(s)) return false;
        String host = uri.getHost() != null ? uri.getHost().trim().toLowerCase(Locale.ROOT) : "";
        return "t.me".equals(host)
            || "www.t.me".equals(host)
            || "telegram.me".equals(host)
            || "www.telegram.me".equals(host)
            || "telegram.dog".equals(host);
    }

    public static boolean isAllowedExternalUri(Uri uri) {
        if (uri == null) return false;
        if (isTelegramUri(uri)) return true;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        String s = scheme.trim().toLowerCase(Locale.ROOT);
        if (!"https".equals(s)) return false;
        String host = uri.getHost();
        if (host == null) return false;
        String h = host.trim().toLowerCase(Locale.ROOT);
        String p = uri.getPath() != null ? uri.getPath().trim().toLowerCase(Locale.ROOT) : "";
        if ("github.com".equals(h) || "www.github.com".equals(h) || "raw.githubusercontent.com".equals(h)) {
            return p.startsWith("/iathor/");
        }
        if ("objects.githubusercontent.com".equals(h) || "release-assets.githubusercontent.com".equals(h)) {
            return true;
        }
        if (isDomainOrSubdomain(h, "workers.dev")) {
            return true;
        }
        return "klevpro.ru".equals(h)
            || "www.klevpro.ru".equals(h)
            || isDomainOrSubdomain(h, "klevpro.ru")
            || "xn--b1apdneg0j.xn--p1ai".equals(h);
    }
}
