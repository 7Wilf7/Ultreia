package run.ultreia.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "UltreiaMainActivity";
    private static final String PREFS_NAME = "ultreia_native_startup";
    private static final String KEY_WEBVIEW_CACHE_CLEARED_VERSION = "webview_cache_cleared_version";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        // Register the custom native plugins before the bridge initializes so JS
        // can call ApkInstaller.install({ path }), ApkDownloader.download(...),
        // and PosterSaver.savePng(...).
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ApkDownloaderPlugin.class);
        registerPlugin(PosterSaverPlugin.class);
        registerPlugin(UltreiaGetuiPlugin.class);
        registerPlugin(UltreiaKeepAlivePlugin.class);
        clearWebViewCacheAfterVersionUpdate();
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
}
