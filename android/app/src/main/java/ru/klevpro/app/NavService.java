package ru.klevpro.app;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public class NavService extends Service {
    @Override
    public int onStartCommand(Intent i, int flags, int id) {
        Notification n;
        if (Build.VERSION.SDK_INT >= 26) {
            n = new Notification.Builder(this, "klev_pro_nav")
                .setContentTitle("Клёв ПРО 2.0 • ведение по маршруту")
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
        } else {
            n = new Notification.Builder(this)
                .setContentTitle("Клёв ПРО 2.0 • ведение по маршруту")
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
        }
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1999, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(1999, n);
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }
}
