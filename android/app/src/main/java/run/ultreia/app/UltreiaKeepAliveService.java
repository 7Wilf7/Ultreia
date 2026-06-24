package run.ultreia.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.TypefaceSpan;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public class UltreiaKeepAliveService extends Service {
    private static final String CHANNEL_ID = "ultreia_keep_alive_silent_v2";
    private static final int NOTIFICATION_ID = 7701;
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_LEFT_TOP_LABEL = "leftTopLabel";
    private static final String EXTRA_LEFT_TOP_VALUE = "leftTopValue";
    private static final String EXTRA_LEFT_BOTTOM_LABEL = "leftBottomLabel";
    private static final String EXTRA_LEFT_BOTTOM_VALUE = "leftBottomValue";
    private static final String EXTRA_RIGHT_TOP_LABEL = "rightTopLabel";
    private static final String EXTRA_RIGHT_TOP_VALUE = "rightTopValue";
    private static final String EXTRA_RIGHT_BOTTOM_LABEL = "rightBottomLabel";
    private static final String EXTRA_RIGHT_BOTTOM_VALUE = "rightBottomValue";
    private static volatile boolean running = false;
    private static String notificationTitle = "This month";
    private static String notificationBody = "Sessions   0     · Time      0m\nDistance   0.0km · Ascent     0m";
    private static String leftTopLabel = "Sessions";
    private static String leftTopValue = "0";
    private static String leftBottomLabel = "Distance";
    private static String leftBottomValue = "0.0km";
    private static String rightTopLabel = "Time";
    private static String rightTopValue = "0m";
    private static String rightBottomLabel = "Ascent";
    private static String rightBottomValue = "0m";

    public static void start(
        Context context,
        String title,
        String body,
        String nextLeftTopLabel,
        String nextLeftTopValue,
        String nextLeftBottomLabel,
        String nextLeftBottomValue,
        String nextRightTopLabel,
        String nextRightTopValue,
        String nextRightBottomLabel,
        String nextRightBottomValue
    ) {
        Intent intent = new Intent(context, UltreiaKeepAliveService.class);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_BODY, body);
        intent.putExtra(EXTRA_LEFT_TOP_LABEL, nextLeftTopLabel);
        intent.putExtra(EXTRA_LEFT_TOP_VALUE, nextLeftTopValue);
        intent.putExtra(EXTRA_LEFT_BOTTOM_LABEL, nextLeftBottomLabel);
        intent.putExtra(EXTRA_LEFT_BOTTOM_VALUE, nextLeftBottomValue);
        intent.putExtra(EXTRA_RIGHT_TOP_LABEL, nextRightTopLabel);
        intent.putExtra(EXTRA_RIGHT_TOP_VALUE, nextRightTopValue);
        intent.putExtra(EXTRA_RIGHT_BOTTOM_LABEL, nextRightBottomLabel);
        intent.putExtra(EXTRA_RIGHT_BOTTOM_VALUE, nextRightBottomValue);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, UltreiaKeepAliveService.class);
        context.stopService(intent);
    }

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (intent != null) {
                String title = intent.getStringExtra(EXTRA_TITLE);
                String body = intent.getStringExtra(EXTRA_BODY);
                if (title != null && title.length() > 0) notificationTitle = title;
                if (body != null && body.length() > 0) notificationBody = body;
                leftTopLabel = nonEmpty(intent.getStringExtra(EXTRA_LEFT_TOP_LABEL), leftTopLabel);
                leftTopValue = nonEmpty(intent.getStringExtra(EXTRA_LEFT_TOP_VALUE), leftTopValue);
                leftBottomLabel = nonEmpty(intent.getStringExtra(EXTRA_LEFT_BOTTOM_LABEL), leftBottomLabel);
                leftBottomValue = nonEmpty(intent.getStringExtra(EXTRA_LEFT_BOTTOM_VALUE), leftBottomValue);
                rightTopLabel = nonEmpty(intent.getStringExtra(EXTRA_RIGHT_TOP_LABEL), rightTopLabel);
                rightTopValue = nonEmpty(intent.getStringExtra(EXTRA_RIGHT_TOP_VALUE), rightTopValue);
                rightBottomLabel = nonEmpty(intent.getStringExtra(EXTRA_RIGHT_BOTTOM_LABEL), rightBottomLabel);
                rightBottomValue = nonEmpty(intent.getStringExtra(EXTRA_RIGHT_BOTTOM_VALUE), rightBottomValue);
            }
            Notification notification = buildNotification();
            if (running) {
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) manager.notify(NOTIFICATION_ID, notification);
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ServiceCompat.startForeground(
                        this,
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    );
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                running = true;
            }
        } catch (Exception e) {
            running = false;
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Ultreia background",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps daily coach push more reliable");
        channel.setShowBadge(false);
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setAction(Intent.ACTION_MAIN);
        launch.addCategory(Intent.CATEGORY_LAUNCHER);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, launch, flags);
        CharSequence body = monospaceBody();

        RemoteViews compactStats = buildStatsView();
        RemoteViews expandedStats = buildStatsView();

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(notificationTitle)
            .setContentText(body)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(compactStats)
            .setCustomBigContentView(expandedStats)
            .setContentIntent(pending)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setLocalOnly(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private CharSequence monospaceBody() {
        SpannableString text = new SpannableString(notificationBody);
        text.setSpan(new TypefaceSpan("monospace"), 0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return text;
    }

    private RemoteViews buildStatsView() {
        RemoteViews views = new RemoteViews(getPackageName(), R.layout.notification_keep_alive_stats);
        views.setTextViewText(R.id.keep_alive_left_top_label, leftTopLabel);
        views.setTextViewText(R.id.keep_alive_left_top_value, leftTopValue);
        views.setTextViewText(R.id.keep_alive_left_bottom_label, leftBottomLabel);
        views.setTextViewText(R.id.keep_alive_left_bottom_value, leftBottomValue);
        views.setTextViewText(R.id.keep_alive_right_top_label, rightTopLabel);
        views.setTextViewText(R.id.keep_alive_right_top_value, rightTopValue);
        views.setTextViewText(R.id.keep_alive_right_bottom_label, rightBottomLabel);
        views.setTextViewText(R.id.keep_alive_right_bottom_value, rightBottomValue);
        return views;
    }

    private static String nonEmpty(String value, String fallback) {
        return value != null && value.length() > 0 ? value : fallback;
    }
}
