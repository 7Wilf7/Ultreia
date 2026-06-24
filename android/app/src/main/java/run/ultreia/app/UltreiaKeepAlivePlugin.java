package run.ultreia.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UltreiaKeepAlive")
public class UltreiaKeepAlivePlugin extends Plugin {
    private static final String AGENT_CHANNEL_ID = "ultreia_agent_done_silent_v2";

    @PluginMethod
    public void start(PluginCall call) {
        try {
            String title = call.getString("title", "This month");
            String body = call.getString("body", "Sessions   0     · Time      0m\nDistance   0.0km · Ascent     0m");
            String leftTopLabel = call.getString("leftTopLabel", "Sessions");
            String leftTopValue = call.getString("leftTopValue", "0");
            String leftBottomLabel = call.getString("leftBottomLabel", "Distance");
            String leftBottomValue = call.getString("leftBottomValue", "0.0km");
            String rightTopLabel = call.getString("rightTopLabel", "Time");
            String rightTopValue = call.getString("rightTopValue", "0m");
            String rightBottomLabel = call.getString("rightBottomLabel", "Ascent");
            String rightBottomValue = call.getString("rightBottomValue", "0m");
            UltreiaKeepAliveService.start(
                getContext(),
                title,
                body,
                leftTopLabel,
                leftTopValue,
                leftBottomLabel,
                leftBottomValue,
                rightTopLabel,
                rightTopValue,
                rightBottomLabel,
                rightBottomValue
            );
            JSObject ret = new JSObject();
            ret.put("running", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            UltreiaKeepAliveService.stop(getContext());
            JSObject ret = new JSObject();
            ret.put("running", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", UltreiaKeepAliveService.isRunning());
        call.resolve(ret);
    }

    @PluginMethod
    public void notifyDone(PluginCall call) {
        try {
            String title = call.getString("title", "Ultreia");
            String body = call.getString("body", "Your task is ready.");
            createAgentChannel();

            Intent launch = new Intent(getContext(), MainActivity.class);
            launch.setAction(Intent.ACTION_MAIN);
            launch.addCategory(Intent.CATEGORY_LAUNCHER);
            launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pending = PendingIntent.getActivity(getContext(), 0, launch, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), AGENT_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS);

            NotificationManager manager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), builder.build());
            JSObject ret = new JSObject();
            ret.put("shown", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    private void createAgentChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            AGENT_CHANNEL_ID,
            "Agent task results",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("AI report and coach task completion alerts");
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        NotificationManager manager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
