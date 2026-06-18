package run.ultreia.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.igexin.sdk.PushManager;

@CapacitorPlugin(name = "UltreiaGetui")
public class UltreiaGetuiPlugin extends Plugin {
    private static UltreiaGetuiPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        try {
            PushManager.getInstance().preInit(getContext());
            PushManager.getInstance().initialize(getContext());
            String cid = PushManager.getInstance().getClientid(getContext());
            if (cid == null || cid.isEmpty()) {
                cid = UltreiaGetuiIntentService.getSavedClientId(getContext());
            }
            JSObject ret = new JSObject();
            ret.put("cid", cid == null ? "" : cid);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "getui init failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void getClientId(PluginCall call) {
        try {
            String cid = PushManager.getInstance().getClientid(getContext());
            if (cid == null || cid.isEmpty()) {
                cid = UltreiaGetuiIntentService.getSavedClientId(getContext());
            }
            JSObject ret = new JSObject();
            ret.put("cid", cid == null ? "" : cid);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "getui cid read failed" : e.getMessage());
        }
    }

    static void notifyClientId(JSObject payload) {
        if (instance != null) {
            instance.notifyListeners("getuiClientId", payload, true);
        }
    }
}
