package run.ultreia.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.igexin.sdk.GTIntentService;
import com.igexin.sdk.message.GTCmdMessage;
import com.igexin.sdk.message.GTNotificationMessage;
import com.igexin.sdk.message.GTTransmitMessage;

public class UltreiaGetuiIntentService extends GTIntentService {
    private static final String TAG = "UltreiaGetui";
    private static final String PREFS = "ultreia_getui";
    private static final String KEY_CID = "cid";

    @Override
    public void onReceiveServicePid(Context context, int pid) {
        Log.i(TAG, "push service pid=" + pid);
    }

    @Override
    public void onReceiveClientId(Context context, String clientid) {
        Log.i(TAG, "received cid=" + preview(clientid));
        if (clientid != null && !clientid.isEmpty()) {
            prefs(context).edit().putString(KEY_CID, clientid).apply();
        }
        JSObject payload = new JSObject();
        payload.put("cid", clientid);
        UltreiaGetuiPlugin.notifyClientId(payload);
    }

    @Override
    public void onReceiveMessageData(Context context, GTTransmitMessage msg) {
        Log.i(TAG, "received transmission task=" + msg.getTaskId());
    }

    @Override
    public void onReceiveOnlineState(Context context, boolean online) {
        Log.i(TAG, "online=" + online);
    }

    @Override
    public void onReceiveCommandResult(Context context, GTCmdMessage cmdMessage) {
        Log.i(TAG, "command result=" + cmdMessage);
    }

    @Override
    public void onNotificationMessageArrived(Context context, GTNotificationMessage msg) {
        Log.i(TAG, "notification arrived task=" + msg.getTaskId());
    }

    @Override
    public void onNotificationMessageClicked(Context context, GTNotificationMessage msg) {
        Log.i(TAG, "notification clicked task=" + msg.getTaskId());
    }

    private static String preview(String value) {
        if (value == null || value.length() <= 10) return value;
        return value.substring(0, 10) + "...";
    }

    static String getSavedClientId(Context context) {
        return prefs(context).getString(KEY_CID, "");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
