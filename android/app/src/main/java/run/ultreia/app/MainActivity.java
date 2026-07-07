package run.ultreia.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "UltreiaMainActivity";
    private static final String PREFS_NAME = "ultreia_native_startup";
    private static final String KEY_WEBVIEW_CACHE_CLEARED_VERSION = "webview_cache_cleared_version";
    private static final String KEY_WEBVIEW_RUNTIME_CLEANED_VERSION = "webview_runtime_cleaned_version";
    private static final String WEBVIEW_RUNTIME_CLEANUP_SCRIPT =
            "(async function(){try{"
                    + "if('serviceWorker' in navigator){"
                    + "var regs=await navigator.serviceWorker.getRegistrations();"
                    + "await Promise.all(regs.map(function(r){return r.unregister();}));"
                    + "}"
                    + "if(typeof caches!=='undefined'){"
                    + "var keys=await caches.keys();"
                    + "await Promise.all(keys.map(function(k){return caches.delete(k);}));"
                    + "}"
                    + "}catch(e){}return 'done';})();";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom native plugins before the bridge initializes so JS
        // can call ApkInstaller.install({ path }), ApkDownloader.download(...),
        // and PosterSaver.savePng(...).
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ApkDownloaderPlugin.class);
        registerPlugin(PosterSaverPlugin.class);
        registerPlugin(UltreiaGetuiPlugin.class);
        registerPlugin(UltreiaKeepAlivePlugin.class);
        clearWebViewCacheAfterVersionUpdate();
        installWebViewRuntimeCleanup();
        super.onCreate(savedInstanceState);
    }

    private void clearWebViewCacheAfterVersionUpdate() {
        String currentVersion = getCurrentVersionName();
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (currentVersion.equals(prefs.getString(KEY_WEBVIEW_CACHE_CLEARED_VERSION, null))) {
            return;
        }

        WebView webView = null;
        try {
            webView = new WebView(getApplicationContext());
            webView.clearCache(true);
            prefs.edit().putString(KEY_WEBVIEW_CACHE_CLEARED_VERSION, currentVersion).apply();
        } catch (Exception e) {
            Log.w(TAG, "Failed to clear WebView cache after update", e);
        } finally {
            if (webView != null) {
                webView.destroy();
            }
        }
    }

    private String getCurrentVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (info.versionName != null) {
                return info.versionName;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to read package version", e);
        }
        return "unknown";
    }

    private void installWebViewRuntimeCleanup() {
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                String currentVersion = getCurrentVersionName();
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                if (currentVersion.equals(prefs.getString(KEY_WEBVIEW_RUNTIME_CLEANED_VERSION, null))) {
                    return;
                }

                webView.evaluateJavascript(WEBVIEW_RUNTIME_CLEANUP_SCRIPT, value -> {
                    prefs.edit().putString(KEY_WEBVIEW_RUNTIME_CLEANED_VERSION, currentVersion).apply();
                    webView.post(webView::reload);
                });
            }
        });
    }
}
